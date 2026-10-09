import type { RequestHandler } from 'express'
import { CreateCheckoutBodySchema, InfinitePayWebhookSchema, ReconcileOrderBodySchema, BillingOrderParamsSchema } from '../schemas/billing.schema'
import { getValidated } from '../middleware/validate-request'
import type { BillingService } from '../services/billing.service'
import type { BillingOrder } from '../domain/billing'

const publicOrder = (order: BillingOrder) => ({
  id: order.id,
  planId: order.planId,
  amountInCents: order.amountInCents,
  status: order.status,
  checkoutUrl: order.checkoutUrl,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
})

export class BillingController {
  public constructor(
    private readonly service: BillingService,
    private readonly triggerReconciliation: () => void = () => undefined,
  ) {}

  public readonly catalog: RequestHandler = (_req, res) => {
    res.set('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
    res.json({ data: this.service.catalog() })
  }

  public readonly createCheckout: RequestHandler = async (req, res) => {
    const { planId } = getValidated(res, 'body', CreateCheckoutBodySchema)
    const result = await this.service.createCheckout(res.locals.userId!, planId, res.locals.idempotencyKey!)
    res.status(result.created ? 201 : 200).json({ data: publicOrder(result.order) })
  }

  public readonly webhook: RequestHandler = async (_req, res) => {
    const event = getValidated(res, 'body', InfinitePayWebhookSchema)
    await this.service.acceptWebhook(event)
    this.triggerReconciliation()
    res.status(200).json({ success: true, message: null })
  }

  public readonly reconcile: RequestHandler = async (_req, res) => {
    const { id } = getValidated(res, 'params', BillingOrderParamsSchema)
    const body = getValidated(res, 'body', ReconcileOrderBodySchema)
    const result = await this.service.reconcileOrder(res.locals.userId!, id, body)
    res.json({ data: publicOrder(result.order) })
  }

  public readonly me: RequestHandler = async (_req, res) => {
    res.set('cache-control', 'no-store')
    res.json({ data: await this.service.getMe(res.locals.userId!) })
  }
}
