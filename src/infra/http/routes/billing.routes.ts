import { Router, type RequestHandler } from 'express';
import type { BillingController } from '../../controllers/billing.controller';
import { authenticate } from '../../../middleware/authenticate';
import {
  billingCheckoutRateLimit,
  billingWebhookRateLimit,
} from '../../../middleware/rate-limit';
import { validateRequest } from '../../../middleware/validate-request';
import {
  BillingOrderParamsSchema,
  CreateCheckoutBodySchema,
  IdempotencyKeySchema,
  InfinitePayWebhookSchema,
  ReconcileOrderBodySchema,
} from '../../../schemas/billing.schema';

const requireIdempotencyKey: RequestHandler = (req, res, next) => {
  const parsed = IdempotencyKeySchema.safeParse(req.header('idempotency-key'));
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message:
        'Envie uma chave Idempotency-Key válida entre 8 e 128 caracteres.',
      requestId: res.locals.requestId,
    });
    return;
  }
  res.locals.idempotencyKey = parsed.data;
  next();
};

const paymentUnavailable: RequestHandler = (_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND' });
};

export const createBillingRouter = (
  controller: BillingController,
  authenticateRequest: RequestHandler = authenticate,
  paymentsEnabled = true,
): Router => {
  const router = Router();

  router.get('/catalog', controller.catalog);
  if (paymentsEnabled) {
    router.post(
      '/webhooks/infinitepay',
      billingWebhookRateLimit,
      validateRequest({ body: InfinitePayWebhookSchema }),
      controller.webhook,
    );
  } else {
    router.post('/webhooks/infinitepay', paymentUnavailable);
    router.post('/checkouts', paymentUnavailable);
    router.post('/orders/:id/reconcile', paymentUnavailable);
  }

  router.use(authenticateRequest);
  if (paymentsEnabled) {
    router.post(
      '/checkouts',
      billingCheckoutRateLimit,
      requireIdempotencyKey,
      validateRequest({ body: CreateCheckoutBodySchema }),
      controller.createCheckout,
    );
    router.post(
      '/orders/:id/reconcile',
      billingCheckoutRateLimit,
      validateRequest({
        params: BillingOrderParamsSchema,
        body: ReconcileOrderBodySchema,
      }),
      controller.reconcile,
    );
  }
  router.get('/me', controller.me);
  return router;
};
