import { describe, expect, test } from 'bun:test'
import type { AiOperation } from '../config/llm'
import { BILLING_PLANS, type BillingOrder, type BillingRepository, type CreditBalance } from '../domain/billing'
import { BillingService } from './billing.service'
import { AppError } from './errors'
import type { InfinitePayClient } from './infinitepay.client'

const ownerId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'

const order = (overrides: Partial<BillingOrder> = {}): BillingOrder => ({
  id: orderId,
  ownerId,
  planId: 'ESSENTIAL',
  amountInCents: 2_990,
  status: 'CHECKOUT_READY',
  checkoutUrl: 'https://checkout.infinitepay.com.br/masterme?lenc=safe',
  transactionNsu: null,
  invoiceSlug: null,
  createdAt: '2026-10-09T12:00:00.000Z',
  updatedAt: '2026-10-09T12:00:00.000Z',
  ...overrides,
})

class FakeBillingRepository implements BillingRepository {
  public storedOrder: BillingOrder | undefined
  public createCalls = 0
  public confirmed = 0
  public confirmationError: unknown
  public reservations: AiOperation[] = []
  public webhookCalls: unknown[] = []
  public pendingWebhooks: Array<{ id: number; orderId: string; transactionNsu: string; invoiceSlug: string; attempts: number; leaseToken: string }> = []
  public finishedWebhooks: unknown[] = []

  public async createOrGetOrder(input: { id: string; ownerId: string; planId: 'ESSENTIAL' | 'PRO'; amountInCents: number; idempotencyKeyHash: string }) {
    this.createCalls += 1
    if (this.storedOrder) return { order: this.storedOrder, created: false }
    this.storedOrder = order({ id: input.id, ownerId: input.ownerId, planId: input.planId, amountInCents: input.amountInCents, status: 'PENDING', checkoutUrl: null })
    return { order: this.storedOrder, created: true }
  }
  public async claimCheckout(): Promise<boolean> { return true }
  public async setCheckoutReady(_id: string, url: string): Promise<BillingOrder> { this.storedOrder = order({ ...(this.storedOrder ?? {}), checkoutUrl: url, status: 'CHECKOUT_READY' }); return this.storedOrder }
  public async setCheckoutFailed(): Promise<void> { if (this.storedOrder) this.storedOrder = { ...this.storedOrder, status: 'CHECKOUT_FAILED' } }
  public async findOrder(id: string): Promise<BillingOrder | undefined> { return id === this.storedOrder?.id ? this.storedOrder : undefined }
  public async findOrderForOwner(id: string, requestedOwner: string): Promise<BillingOrder | undefined> { return id === this.storedOrder?.id && requestedOwner === this.storedOrder.ownerId ? this.storedOrder : undefined }
  public async recordWebhook(input: unknown): Promise<number> { this.webhookCalls.push(input); return 1 }
  public async claimPendingWebhooks() { const claimed = [...this.pendingWebhooks]; this.pendingWebhooks = []; return claimed }
  public async finishWebhook(...input: unknown[]): Promise<void> { this.finishedWebhooks.push(input) }
  public async confirmPayment(): Promise<BillingOrder> {
    if (this.confirmationError) throw this.confirmationError
    this.confirmed += 1
    this.storedOrder = order({ ...(this.storedOrder ?? {}), status: 'PAID' })
    return this.storedOrder
  }
  public async reserveCredits(_ownerId: string, operation: AiOperation): Promise<void> { this.reservations.push(operation) }
  public async getCreditBalance(): Promise<CreditBalance> {
    return { planId: 'FREE', dailyLimit: 10, dailyUsed: 2, dailyRemaining: 8, dailyResetsAt: '2026-10-10T00:00:00.000Z', periodLimit: 120, periodUsed: 20, periodRemaining: 100, periodStartsAt: '2026-10-01T00:00:00.000Z', periodEndsAt: '2026-11-01T00:00:00.000Z', validUntil: null }
  }
}

describe('BillingService', () => {
  test('catálogo fixa preços, vigências, limites e pesos comerciais', () => {
    const service = new BillingService(new FakeBillingRepository(), undefined, { publicAppUrl: 'https://masterme.app', maxProviderAttempts: 2 })
    expect(service.catalog()).toMatchObject({
      currency: 'BRL',
      billingType: 'ONE_TIME',
      plans: [
        { id: 'FREE', priceInCents: 0, durationDays: null, dailyCreditLimit: 10, periodCreditLimit: 120 },
        { id: 'ESSENTIAL', priceInCents: 2_990, durationDays: 30, dailyCreditLimit: 120, periodCreditLimit: 1_500 },
        { id: 'PRO', priceInCents: 24_900, durationDays: 365, dailyCreditLimit: 180, periodCreditLimit: 15_000 },
      ],
      creditWeights: { INITIAL_EVALUATION: 2, EDGE_CASE_GENERATION: 4, LOCALIZATION: 6, PRACTICE_PROJECT: 8, EXTRACTION: 12 },
    })
    expect(JSON.stringify(service.catalog())).not.toContain('checkoutDescription')
  })

  test('mantém catálogo/free ativos e falha checkout de forma segura sem handle', async () => {
    const service = new BillingService(new FakeBillingRepository(), undefined, { publicAppUrl: 'https://masterme.app', maxProviderAttempts: 2 })
    expect(service.catalog().plans).toHaveLength(3)
    await expect(service.createCheckout(ownerId, 'ESSENTIAL', 'request-123')).rejects.toMatchObject({ statusCode: 503, code: 'BILLING_NOT_CONFIGURED' })
  })

  test('rejeita plano desconhecido e nunca aceita preço do cliente', async () => {
    const repository = new FakeBillingRepository()
    const service = new BillingService(repository, undefined, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })
    await expect(service.createCheckout(ownerId, 'ENTERPRISE' as never, 'request-123')).rejects.toMatchObject({ statusCode: 400, code: 'UNKNOWN_PLAN' })
    expect(repository.createCalls).toBe(0)
  })

  test('usa preço, descrição e URLs canônicas do servidor', async () => {
    const repository = new FakeBillingRepository()
    let providerInput: unknown
    const provider = { createCheckout: async (input: unknown) => { providerInput = input; return { url: 'https://checkout.infinitepay.com.br/masterme?lenc=safe' } } } as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    const result = await service.createCheckout(ownerId, 'ESSENTIAL', 'request-123')

    expect(result.order.amountInCents).toBe(BILLING_PLANS.ESSENTIAL.priceInCents)
    expect(providerInput).toMatchObject({
      handle: 'masterme',
      priceInCents: 2_990,
      description: BILLING_PLANS.ESSENTIAL.checkoutDescription,
      webhookUrl: 'https://masterme.app/api/billing/webhooks/infinitepay',
    })
    expect(String((providerInput as { redirectUrl: string }).redirectUrl)).toStartWith('https://masterme.app/pagamento/retorno?orderId=')
  })

  test('repetição idempotente devolve o mesmo checkout sem chamar o provedor', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    let providerCalls = 0
    const provider = { createCheckout: async () => { providerCalls += 1; return { url: 'https://checkout.infinitepay.com.br/new' } } } as unknown as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    await expect(service.createCheckout(ownerId, 'ESSENTIAL', 'request-123')).resolves.toEqual({ order: repository.storedOrder, created: false })
    expect(providerCalls).toBe(0)
  })

  test('não concede entitlement quando payment_check diverge do valor do pedido', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order({ transactionNsu: 'transaction-1', invoiceSlug: 'invoice-1' })
    const provider = { checkPayment: async () => ({ success: true, paid: true, amount: 1, paidAmount: 1, installments: 1, captureMethod: 'pix' }) } as unknown as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    await expect(service.reconcileOrder(ownerId, orderId, {})).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_AMOUNT_MISMATCH' })
    expect(repository.confirmed).toBe(0)
  })

  test('oculta pedido pertencente a outro usuário', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    const service = new BillingService(repository, undefined, { publicAppUrl: 'https://masterme.app', maxProviderAttempts: 2 })
    await expect(service.reconcileOrder('33333333-3333-4333-8333-333333333333', orderId, {})).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  test('webhook forjado com valor divergente não persiste referência nem agenda confirmação', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    const service = new BillingService(repository, undefined, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    await expect(service.acceptWebhook({
      invoice_slug: 'invoice-forged',
      amount: 1,
      transaction_nsu: 'transaction-forged',
      order_nsu: orderId,
    })).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_AMOUNT_MISMATCH' })
    expect(repository.webhookCalls).toEqual([])
    expect(repository.storedOrder.transactionNsu).toBeNull()
  })

  test('fila durável reconcilia pelo payment_check e finaliza o evento', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    repository.pendingWebhooks = [{ id: 7, orderId, transactionNsu: 'transaction-1', invoiceSlug: 'invoice-1', attempts: 1, leaseToken: '77777777-7777-4777-8777-777777777777' }]
    const provider = { checkPayment: async () => ({ success: true, paid: true, amount: 2_990, paidAmount: 2_990, installments: 1, captureMethod: 'pix' }) } as unknown as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    expect(await service.processPendingWebhooks()).toBe(1)
    expect(repository.confirmed).toBe(1)
    expect(repository.finishedWebhooks).toEqual([[7, '77777777-7777-4777-8777-777777777777', null, false]])
  })

  test('pagamento ainda não confirmado é terminal até um webhook realmente novo criar outro evento', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    repository.pendingWebhooks = [{ id: 8, orderId, transactionNsu: 'transaction-pending', invoiceSlug: 'invoice-pending', attempts: 1, leaseToken: '88888888-8888-4888-8888-888888888888' }]
    const provider = { checkPayment: async () => ({ success: true, paid: false, amount: 2_990, paidAmount: 0, installments: 1, captureMethod: 'pix' }) } as unknown as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    expect(await service.processPendingWebhooks()).toBe(1)
    expect(repository.confirmed).toBe(0)
    expect(repository.finishedWebhooks).toEqual([[8, '88888888-8888-4888-8888-888888888888', 'PAYMENT_NOT_CONFIRMED', false]])
  })

  test('transação já concedida a outro pedido encerra o evento sem retry', async () => {
    const repository = new FakeBillingRepository()
    repository.storedOrder = order()
    repository.confirmationError = new AppError(409, 'PAYMENT_ALREADY_USED', 'A transação já foi vinculada a outro pedido.')
    repository.pendingWebhooks = [{ id: 9, orderId, transactionNsu: 'transaction-reused', invoiceSlug: 'invoice-reused', attempts: 1, leaseToken: '99999999-9999-4999-8999-999999999999' }]
    const provider = { checkPayment: async () => ({ success: true, paid: true, amount: 2_990, paidAmount: 2_990, installments: 1, captureMethod: 'pix' }) } as unknown as InfinitePayClient
    const service = new BillingService(repository, provider, { publicAppUrl: 'https://masterme.app', infinitePayHandle: 'masterme', maxProviderAttempts: 2 })

    expect(await service.processPendingWebhooks()).toBe(1)
    expect(repository.finishedWebhooks).toEqual([[9, '99999999-9999-4999-8999-999999999999', 'PAYMENT_ALREADY_USED', false]])
  })

  test('resumo usa a menor folga e contabiliza todos os fallbacks na estimativa conservadora', async () => {
    const repository = new FakeBillingRepository()
    const service = new BillingService(repository, undefined, { publicAppUrl: 'https://masterme.app', maxProviderAttempts: 2 })
    const summary = await service.getMe(ownerId)
    expect(summary.estimates.INITIAL_EVALUATION).toBe(2)
    expect(summary.estimates.EXTRACTION).toBe(0)
  })
})
