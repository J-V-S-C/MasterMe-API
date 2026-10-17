import type { AiOperation, CreditPolicy } from '../domain/billing';

export interface BillingConfiguration {
  publicAppUrl: string;
  infinitePayHandle?: string;
  maxProviderAttempts: number;
  creditPolicy?: CreditPolicy;
}

export interface BillingWebhook {
  order_nsu: string;
  transaction_nsu: string;
  invoice_slug: string;
  amount: number;
}

export interface BillingMetrics {
  recordCredit(operation: AiOperation, result: 'reserved' | 'blocked'): void;
  recordBilling(result: string): void;
}
