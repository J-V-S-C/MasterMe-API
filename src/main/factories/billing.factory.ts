import type { Pool } from 'pg';
import type { Environment } from '../../config/environment';
import type { MetricsRegistry } from '../../middleware/observability';
import { PostgresBillingRepository } from '../../infra/repositories/postgres/postgres-billing.repository';
import { InfinitePayClient } from '../../infra/payments/infinitepay.client';
import { BillingService } from '../../application/services/billing.service';
import { BillingController } from '../../infra/controllers/billing.controller';

export function makeBillingService(
  pool: Pool,
  environment: Environment,
  metrics: MetricsRegistry,
): BillingService {
  const repository = new PostgresBillingRepository(pool);
  const provider = environment.INFINITEPAY_HANDLE
    ? new InfinitePayClient(fetch, environment.INFINITEPAY_TIMEOUT_MS)
    : undefined;
  return new BillingService(repository, provider, {
    publicAppUrl: environment.PUBLIC_APP_URL,
    infinitePayHandle: environment.INFINITEPAY_HANDLE,
    maxProviderAttempts: new Set([environment.MODEL_NAME, ...environment.GEMINI_MODEL_FALLBACKS]).size,
    creditPolicy: { enabled: environment.AI_CREDITS_ENABLED, globalDailyLimit: environment.AI_GLOBAL_DAILY_CREDIT_LIMIT },
  }, metrics);
}

export function makeBillingFactory(
  pool: Pool,
  environment: Environment,
  metrics: MetricsRegistry,
  triggerReconciliation: () => void = () => undefined,
) {
  const service = makeBillingService(pool, environment, metrics);
  const controller = new BillingController(service, triggerReconciliation);
  return { service, controller };
}
