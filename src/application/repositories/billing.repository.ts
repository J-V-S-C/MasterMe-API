import type { BillingOrder, CreditBalance, CreditPolicy, PaidBillingPlanId, PendingBillingWebhook } from '../domain/billing';
import type { AiOperation } from '../domain/billing';

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
