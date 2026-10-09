import { z } from 'zod'

export const CreateCheckoutBodySchema = z.object({
  planId: z.enum(['ESSENTIAL', 'PRO']),
}).strict()

export const IdempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)

export const BillingOrderParamsSchema = z.object({
  id: z.string().uuid(),
})

export const ReconcileOrderBodySchema = z.object({
  transactionNsu: z.string().trim().min(1).max(160).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
}).strict().refine(
  (value) => (value.transactionNsu === undefined) === (value.slug === undefined),
  { message: 'transactionNsu e slug devem ser enviados juntos.' },
)

export const InfinitePayWebhookSchema = z.object({
  invoice_slug: z.string().trim().min(1).max(160),
  amount: z.number().int().nonnegative(),
  paid_amount: z.number().int().nonnegative().optional(),
  installments: z.number().int().positive().max(24).optional(),
  capture_method: z.string().trim().min(1).max(40).optional(),
  transaction_nsu: z.string().trim().min(1).max(160),
  order_nsu: z.string().uuid(),
  receipt_url: z.string().url().max(2_048).optional(),
  items: z.array(z.unknown()).max(20).optional(),
}).strip()

export type InfinitePayWebhook = z.infer<typeof InfinitePayWebhookSchema>
