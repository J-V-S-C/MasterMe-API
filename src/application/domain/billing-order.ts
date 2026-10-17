import type { BillingOrder, BillingOrderStatus, PaidBillingPlanId } from './billing';

export type BillingOrderViolation = 'INVALID_SNAPSHOT' | 'CHECKOUT_MISMATCH' | 'AMOUNT_MISMATCH' | 'PAYMENT_NOT_CONFIRMED';

export class InvalidBillingOrderError extends Error {
  public constructor(public readonly violation: BillingOrderViolation) {
    super(violation);
    this.name = 'InvalidBillingOrderError';
  }
}

const ORDER_STATUSES: ReadonlySet<BillingOrderStatus> = new Set(['PENDING', 'CHECKOUT_READY', 'CHECKOUT_FAILED', 'PAID']);

/** Commercial invariants; provider calls and persistence belong to application/infra. */
export class BillingOrderAggregate {
  private constructor(private readonly data: BillingOrder) {
    if (!data.id || !data.ownerId || !Number.isSafeInteger(data.amountInCents) || data.amountInCents <= 0 || !ORDER_STATUSES.has(data.status)) {
      throw new InvalidBillingOrderError('INVALID_SNAPSHOT');
    }
  }

  public static rehydrate(snapshot: BillingOrder): BillingOrderAggregate {
    return new BillingOrderAggregate({ ...snapshot });
  }

  public snapshot(): BillingOrder { return { ...this.data }; }
  public isPaid(): boolean { return this.data.status === 'PAID'; }
  public hasCheckout(): boolean { return Boolean(this.data.checkoutUrl); }

  public assertCheckoutMatches(planId: PaidBillingPlanId, amountInCents: number): void {
    if (this.data.planId !== planId || this.data.amountInCents !== amountInCents) {
      throw new InvalidBillingOrderError('CHECKOUT_MISMATCH');
    }
  }

  public assertReportedAmount(amountInCents: number): void {
    if (this.data.amountInCents !== amountInCents) throw new InvalidBillingOrderError('AMOUNT_MISMATCH');
  }

  public assertVerifiedPayment(confirmation: { success: boolean; paid: boolean; amount: number }): void {
    if (!confirmation.success || !confirmation.paid) throw new InvalidBillingOrderError('PAYMENT_NOT_CONFIRMED');
    this.assertReportedAmount(confirmation.amount);
  }
}
