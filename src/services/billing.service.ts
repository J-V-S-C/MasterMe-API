import { createHash, randomUUID } from 'node:crypto'
import type { AiOperation } from '../config/llm'
import {
  AI_CREDIT_WEIGHTS,
  BILLING_PLANS,
  publicCatalog,
  type BillingOrder,
  type BillingRepository,
  type CreditPolicy,
  type PaidBillingPlanId,
} from '../domain/billing'
import type { InfinitePayWebhook } from '../schemas/billing.schema'
import { AppError, NotFoundError } from './errors'
import type { InfinitePayClient } from './infinitepay.client'
import type { MetricsRegistry } from '../middleware/observability'

type BillingConfiguration = {
  publicAppUrl: string
  infinitePayHandle?: string
  maxProviderAttempts: number
  creditPolicy?: CreditPolicy
}

const idempotencyHash = (ownerId: string, key: string): string =>
  createHash('sha256').update(`${ownerId}:${key}`).digest('hex')

const eventHash = (event: InfinitePayWebhook): string =>
  createHash('sha256').update([event.order_nsu, event.transaction_nsu, event.invoice_slug, event.amount].join(':')).digest('hex')

export class BillingService {
  public constructor(
    private readonly repository: BillingRepository,
    private readonly provider: InfinitePayClient | undefined,
    private readonly configuration: BillingConfiguration,
    private readonly metrics?: Pick<MetricsRegistry, 'recordCredit' | 'recordBilling'>,
  ) {}

  public catalog(): ReturnType<typeof publicCatalog> {
    return publicCatalog()
  }

  public async createCheckout(ownerId: string, planId: PaidBillingPlanId, idempotencyKey: string): Promise<{ order: BillingOrder; created: boolean }> {
    const plan = planId === 'ESSENTIAL' || planId === 'PRO' ? BILLING_PLANS[planId] : undefined
    if (!plan || !plan.durationDays || !plan.checkoutDescription) {
      throw new AppError(400, 'UNKNOWN_PLAN', 'Escolha um plano pago disponível no catálogo.')
    }
    const handle = this.configuration.infinitePayHandle
    if (!handle || !this.provider) {
      throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'O checkout ainda não está disponível. Tente novamente mais tarde.')
    }

    const created = await this.repository.createOrGetOrder({
      id: randomUUID(),
      ownerId,
      planId,
      amountInCents: plan.priceInCents,
      idempotencyKeyHash: idempotencyHash(ownerId, idempotencyKey),
    })
    if (created.order.planId !== planId || created.order.amountInCents !== plan.priceInCents) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'A chave de idempotência já foi usada para outro pedido.')
    }
    if (created.order.checkoutUrl || created.order.status === 'PAID') return { order: created.order, created: false }
    if (!created.created && !(await this.repository.claimCheckout(created.order.id))) {
      throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'Este checkout já está sendo criado. Tente novamente em instantes.')
    }

    const redirectUrl = new URL('/pagamento/retorno', this.configuration.publicAppUrl)
    redirectUrl.searchParams.set('orderId', created.order.id)
    const webhookUrl = new URL('/api/billing/webhooks/infinitepay', this.configuration.publicAppUrl)
    try {
      const checkout = await this.provider.createCheckout({
        handle,
        orderNsu: created.order.id,
        redirectUrl: redirectUrl.toString(),
        webhookUrl: webhookUrl.toString(),
        priceInCents: plan.priceInCents,
        description: plan.checkoutDescription,
      })
      return { order: await this.repository.setCheckoutReady(created.order.id, checkout.url), created: created.created }
    } catch (error) {
      await this.repository.setCheckoutFailed(created.order.id).catch(() => undefined)
      throw error
    }
  }

  public async acceptWebhook(event: InfinitePayWebhook): Promise<{ orderId: string; transactionNsu: string; slug: string }> {
    const order = await this.repository.findOrder(event.order_nsu)
    if (!order) throw new AppError(400, 'PAYMENT_ORDER_NOT_FOUND', 'Pedido não encontrado.')
    if (event.amount !== order.amountInCents) throw new AppError(400, 'PAYMENT_AMOUNT_MISMATCH', 'O valor informado não corresponde ao pedido.')
    await this.repository.recordWebhook({
      orderId: order.id,
      eventKey: eventHash(event),
      transactionNsu: event.transaction_nsu,
      invoiceSlug: event.invoice_slug,
      amountInCents: event.amount,
    })
    return { orderId: order.id, transactionNsu: event.transaction_nsu, slug: event.invoice_slug }
  }

  public async reconcileOrder(ownerId: string, orderId: string, reference: { transactionNsu?: string; slug?: string }): Promise<{ order: BillingOrder }> {
    const order = await this.repository.findOrderForOwner(orderId, ownerId)
    if (!order) throw new NotFoundError('Pedido')
    return { order: await this.reconcile(order, reference) }
  }

  public async reconcileOrderById(orderId: string, reference: { transactionNsu: string; slug: string }): Promise<{ order: BillingOrder }> {
    const order = await this.repository.findOrder(orderId)
    if (!order) throw new NotFoundError('Pedido')
    return { order: await this.reconcile(order, reference) }
  }

  public async processPendingWebhooks(limit = 10): Promise<number> {
    const pending = await this.repository.claimPendingWebhooks(limit)
    for (const event of pending) {
      try {
        await this.reconcileOrderById(event.orderId, { transactionNsu: event.transactionNsu, slug: event.invoiceSlug })
        await this.repository.finishWebhook(event.id, event.leaseToken, null, false)
        this.metrics?.recordBilling('confirmed')
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'RECONCILIATION_FAILED'
        const permanent = code === 'PAYMENT_NOT_CONFIRMED' || code === 'PAYMENT_AMOUNT_MISMATCH' || code === 'PAYMENT_ALREADY_USED' || code === 'NOT_FOUND'
        await this.repository.finishWebhook(event.id, event.leaseToken, code, !permanent && event.attempts < 12)
        this.metrics?.recordBilling(code === 'PAYMENT_NOT_CONFIRMED' ? 'pending' : permanent ? 'rejected' : event.attempts < 12 ? 'retry' : 'failed')
        console.warn(JSON.stringify({ level: 'warn', operation: 'payment-reconciliation', code }))
      }
    }
    return pending.length
  }

  public async reserveCredits(ownerId: string, operation: AiOperation): Promise<void> {
    try {
      await this.repository.reserveCredits(ownerId, operation, this.configuration.creditPolicy ?? { enabled: true, globalDailyLimit: 20_000 })
      this.metrics?.recordCredit(operation, 'reserved')
    } catch (error) {
      this.metrics?.recordCredit(operation, 'blocked')
      throw error
    }
  }

  public async getMe(ownerId: string) {
    const balance = await this.repository.getCreditBalance(ownerId)
    const available = Math.min(balance.dailyRemaining, balance.periodRemaining)
    const attempts = Math.max(1, this.configuration.maxProviderAttempts)
    return {
      ...balance,
      weights: { ...AI_CREDIT_WEIGHTS },
      estimates: Object.fromEntries(Object.entries(AI_CREDIT_WEIGHTS).map(([operation, weight]) => [
        operation,
        Math.floor(available / (weight * attempts)),
      ])) as Record<AiOperation, number>,
      estimateAssumption: { providerAttemptsPerOperation: attempts },
    }
  }

  private async reconcile(order: BillingOrder, reference: { transactionNsu?: string; slug?: string }): Promise<BillingOrder> {
    if (order.status === 'PAID') return order
    const handle = this.configuration.infinitePayHandle
    if (!handle || !this.provider) throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'A confirmação de pagamento ainda não está disponível.')
    const transactionNsu = reference.transactionNsu ?? order.transactionNsu
    const slug = reference.slug ?? order.invoiceSlug
    if (!transactionNsu || !slug) {
      throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED', 'A referência da transação ainda não está disponível.')
    }

    const confirmation = await this.provider.checkPayment({ handle, orderNsu: order.id, transactionNsu, slug })
    if (!confirmation.success || !confirmation.paid) {
      throw new AppError(409, 'PAYMENT_NOT_CONFIRMED', 'O pagamento ainda não foi confirmado.')
    }
    if (confirmation.amount !== order.amountInCents) {
      throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'O valor confirmado não corresponde ao pedido.')
    }
    return this.repository.confirmPayment({
      orderId: order.id,
      transactionNsu,
      invoiceSlug: slug,
      captureMethod: confirmation.captureMethod ?? 'unknown',
    })
  }
}
