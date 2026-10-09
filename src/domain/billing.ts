import { z } from 'zod'
import type { AiOperation } from '../config/llm'

export const BillingPlanIdSchema = z.enum(['FREE', 'ESSENTIAL', 'PRO'])
export type BillingPlanId = z.infer<typeof BillingPlanIdSchema>
export type PaidBillingPlanId = Exclude<BillingPlanId, 'FREE'>

export type BillingPlan = {
  id: BillingPlanId
  name: string
  priceInCents: number
  durationDays: number | null
  dailyCreditLimit: number
  periodCreditLimit: number
  checkoutDescription: string | null
}

export const BILLING_PLANS = Object.freeze({
  FREE: Object.freeze({ id: 'FREE', name: 'Gratuito', priceInCents: 0, durationDays: null, dailyCreditLimit: 10, periodCreditLimit: 120, checkoutDescription: null }),
  ESSENTIAL: Object.freeze({ id: 'ESSENTIAL', name: 'Essencial', priceInCents: 2_990, durationDays: 30, dailyCreditLimit: 120, periodCreditLimit: 1_500, checkoutDescription: 'MasterMe Essencial — 30 dias' }),
  PRO: Object.freeze({ id: 'PRO', name: 'Pro', priceInCents: 24_900, durationDays: 365, dailyCreditLimit: 180, periodCreditLimit: 15_000, checkoutDescription: 'MasterMe Pro — 365 dias' }),
} satisfies Record<BillingPlanId, BillingPlan>)

export const AI_CREDIT_WEIGHTS = Object.freeze({
  INITIAL_EVALUATION: 2,
  STRESS_EVALUATION: 2,
  EDGE_CASE_GENERATION: 4,
  EDGE_CASE_EVALUATION: 4,
  ISOMORPHIC_PROBLEM: 4,
  LOCALIZATION: 6,
  PRACTICE_PROJECT: 8,
  EXTRACTION: 12,
} satisfies Record<AiOperation, number>)

export type BillingOrderStatus = 'PENDING' | 'CHECKOUT_READY' | 'CHECKOUT_FAILED' | 'PAID'

export type BillingOrder = {
  id: string
  ownerId: string
  planId: PaidBillingPlanId
  amountInCents: number
  status: BillingOrderStatus
  checkoutUrl: string | null
  transactionNsu: string | null
  invoiceSlug: string | null
  createdAt: string
  updatedAt: string
}

export type CreditBalance = {
  planId: BillingPlanId
  dailyLimit: number
  dailyUsed: number
  dailyRemaining: number
  dailyResetsAt: string
  periodLimit: number
  periodUsed: number
  periodRemaining: number
  periodStartsAt: string
  periodEndsAt: string
  validUntil: string | null
}

export type CreditPolicy = { enabled: boolean; globalDailyLimit: number }
export type PendingBillingWebhook = { id: number; orderId: string; transactionNsu: string; invoiceSlug: string; attempts: number; leaseToken: string }

export interface BillingRepository {
  createOrGetOrder(input: { id: string; ownerId: string; planId: PaidBillingPlanId; amountInCents: number; idempotencyKeyHash: string }): Promise<{ order: BillingOrder; created: boolean }>
  claimCheckout(orderId: string): Promise<boolean>
  setCheckoutReady(orderId: string, checkoutUrl: string): Promise<BillingOrder>
  setCheckoutFailed(orderId: string): Promise<void>
  findOrder(orderId: string): Promise<BillingOrder | undefined>
  findOrderForOwner(orderId: string, ownerId: string): Promise<BillingOrder | undefined>
  recordWebhook(input: { orderId: string; eventKey: string; transactionNsu: string; invoiceSlug: string; amountInCents: number }): Promise<number>
  claimPendingWebhooks(limit: number): Promise<PendingBillingWebhook[]>
  finishWebhook(eventId: number, leaseToken: string, errorCode: string | null, retry: boolean): Promise<void>
  confirmPayment(input: { orderId: string; transactionNsu: string; invoiceSlug: string; captureMethod: string }): Promise<BillingOrder>
  reserveCredits(ownerId: string, operation: AiOperation, policy: CreditPolicy): Promise<void>
  getCreditBalance(ownerId: string): Promise<CreditBalance>
}

export const publicCatalog = () => ({
  currency: 'BRL' as const,
  billingType: 'ONE_TIME' as const,
  plans: Object.values(BILLING_PLANS).map(({ checkoutDescription: _checkoutDescription, ...plan }) => plan),
  creditWeights: { ...AI_CREDIT_WEIGHTS },
  fallbackPolicy: 'Cada tentativa real no provedor, inclusive fallback, reserva novamente o peso da operação.' as const,
})
