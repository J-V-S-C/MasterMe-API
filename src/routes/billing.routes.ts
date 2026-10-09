import { Router, type RequestHandler } from 'express'
import { BillingController } from '../controllers/billing.controller'
import { authenticate } from '../middleware/authenticate'
import { billingCheckoutRateLimit, billingWebhookRateLimit } from '../middleware/rate-limit'
import { validateRequest } from '../middleware/validate-request'
import { BillingOrderParamsSchema, CreateCheckoutBodySchema, IdempotencyKeySchema, InfinitePayWebhookSchema, ReconcileOrderBodySchema } from '../schemas/billing.schema'
import type { BillingService } from '../services/billing.service'

const requireIdempotencyKey: RequestHandler = (req, res, next) => {
  const parsed = IdempotencyKeySchema.safeParse(req.header('idempotency-key'))
  if (!parsed.success) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Envie uma chave Idempotency-Key válida entre 8 e 128 caracteres.', requestId: res.locals.requestId })
    return
  }
  res.locals.idempotencyKey = parsed.data
  next()
}

export const createBillingRouter = (
  service: BillingService,
  authenticateRequest: RequestHandler = authenticate,
  triggerReconciliation: () => void = () => undefined,
): Router => {
  const router = Router()
  const controller = new BillingController(service, triggerReconciliation)

  router.get('/catalog', controller.catalog)
  router.post('/webhooks/infinitepay', billingWebhookRateLimit, validateRequest({ body: InfinitePayWebhookSchema }), controller.webhook)

  router.use(authenticateRequest)
  router.post('/checkouts', billingCheckoutRateLimit, requireIdempotencyKey, validateRequest({ body: CreateCheckoutBodySchema }), controller.createCheckout)
  router.post('/orders/:id/reconcile', billingCheckoutRateLimit, validateRequest({ params: BillingOrderParamsSchema, body: ReconcileOrderBodySchema }), controller.reconcile)
  router.get('/me', controller.me)
  return router
}
