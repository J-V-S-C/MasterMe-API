export type AiOperation =
  | 'EXTRACTION'
  | 'INITIAL_EVALUATION'
  | 'EDGE_CASE_GENERATION'
  | 'EDGE_CASE_EVALUATION'
  | 'PRACTICE_PROJECT'
  | 'LOCALIZATION'
  | 'STRESS_EVALUATION'
  | 'ISOMORPHIC_PROBLEM';

export type BillingPlanId = 'FREE' | 'ESSENTIAL' | 'PRO'
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
  FREE: Object.freeze({ id: 'FREE', name: 'Gratuito', priceInCents: 0, durationDays: null, dailyCreditLimit: 100, periodCreditLimit: 100, checkoutDescription: null }),
  ESSENTIAL: Object.freeze({ id: 'ESSENTIAL', name: 'Essencial', priceInCents: 2_990, durationDays: 30, dailyCreditLimit: 120, periodCreditLimit: 1_500, checkoutDescription: 'MasterMe Essencial — 30 dias' }),
  PRO: Object.freeze({ id: 'PRO', name: 'Pro', priceInCents: 24_900, durationDays: 365, dailyCreditLimit: 180, periodCreditLimit: 15_000, checkoutDescription: 'MasterMe Pro — 365 dias' }),
} satisfies Record<BillingPlanId, BillingPlan>)

export const AI_CREDIT_WEIGHTS = Object.freeze({
  INITIAL_EVALUATION: 1,
  STRESS_EVALUATION: 1,
  EDGE_CASE_GENERATION: 1,
  EDGE_CASE_EVALUATION: 1,
  ISOMORPHIC_PROBLEM: 1,
  LOCALIZATION: 1,
  PRACTICE_PROJECT: 1,
  EXTRACTION: 1,
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


export const publicCatalog = () => ({
  currency: 'BRL' as const,
  billingType: 'ONE_TIME' as const,
  plans: Object.values(BILLING_PLANS).map(({ checkoutDescription: _checkoutDescription, ...plan }) => plan),
  creditWeights: { ...AI_CREDIT_WEIGHTS },
  fallbackPolicy: 'Cada tentativa real no provedor, inclusive fallback, reserva um crédito.' as const,
})
