import { describe, expect, test } from 'bun:test';
import { BillingOrderAggregate, InvalidBillingOrderError } from './billing-order';
import type { BillingOrder } from './billing';

const order = (overrides: Partial<BillingOrder> = {}): BillingOrder => ({
  id: 'order-1', ownerId: 'owner-1', planId: 'ESSENTIAL', amountInCents: 2_990,
  status: 'CHECKOUT_READY', checkoutUrl: 'https://checkout.example/order-1',
  transactionNsu: null, invoiceSlug: null,
  createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', ...overrides,
});

describe('billing order', () => {
  test('rehydrates without allowing callers to mutate the internal snapshot', () => {
    const source = order();
    const aggregate = BillingOrderAggregate.rehydrate(source);
    source.amountInCents = 1;
    expect(aggregate.snapshot().amountInCents).toBe(2_990);
  });

  test('rejects key reuse for another plan or amount', () => {
    const aggregate = BillingOrderAggregate.rehydrate(order());
    expect(() => aggregate.assertCheckoutMatches('PRO', 24_900)).toThrow(InvalidBillingOrderError);
    expect(() => aggregate.assertCheckoutMatches('ESSENTIAL', 1)).toThrow(InvalidBillingOrderError);
    expect(() => aggregate.assertCheckoutMatches('ESSENTIAL', 2_990)).not.toThrow();
  });

  test('rejects events or confirmations with mismatched amounts', () => {
    const aggregate = BillingOrderAggregate.rehydrate(order());
    expect(() => aggregate.assertReportedAmount(1)).toThrow(InvalidBillingOrderError);
    expect(() => aggregate.assertVerifiedPayment({ success: true, paid: true, amount: 1 })).toThrow(InvalidBillingOrderError);
    expect(() => aggregate.assertVerifiedPayment({ success: true, paid: false, amount: 2_990 })).toThrow(InvalidBillingOrderError);
    expect(() => aggregate.assertVerifiedPayment({ success: true, paid: true, amount: 2_990 })).not.toThrow();
  });

  test('rejects snapshots without a positive price or recognized state', () => {
    expect(() => BillingOrderAggregate.rehydrate(order({ amountInCents: 0 }))).toThrow(InvalidBillingOrderError);
    expect(() => BillingOrderAggregate.rehydrate(order({ status: 'UNKNOWN' as never }))).toThrow(InvalidBillingOrderError);
  });
});
