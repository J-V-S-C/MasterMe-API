import type { Environment } from '../config/environment';
import { Pool } from 'pg';
import { createApp } from '../infra/http/app';
import { BillingReconciler } from './jobs/billing-reconciler';
import { MetricsRegistry } from '../middleware/observability';
import { makeBillingFactory } from './factories/billing.factory';
import { makeMasterMeFactory } from './factories/masterme.factory';
import { makeIngestionFactory } from './factories/ingestion.factory';
import { makeLearningWorkspaceFactory } from './factories/learning-workspace.factory';

export const startApi = (environment: Environment): void => {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: environment.DATABASE_POOL_MAX });
  const metrics = new MetricsRegistry();
  let reconciler: BillingReconciler;
  const reportFailure = () =>
    console.warn(
      JSON.stringify({
        level: 'warn',
        operation: 'payment-reconciliation-drain',
        code: 'DRAIN_FAILED',
      }),
    );
  const triggerReconciliation = () => {
    void reconciler.trigger().catch(reportFailure);
  };
  const billing = makeBillingFactory(pool, environment, metrics, triggerReconciliation);
  reconciler = new BillingReconciler(billing.service);
  if (environment.INFINITEPAY_HANDLE) reconciler.start(60_000, reportFailure);
  const ingestion = makeIngestionFactory(pool, environment);
  const study = makeMasterMeFactory(pool, environment, metrics, billing.service, ingestion.service);
  const app = createApp({
    study: study.controller,
    ingestion: ingestion.controller,
    pool,
    billing: billing.controller,
    paymentsEnabled: Boolean(environment.INFINITEPAY_HANDLE),
    workspace: makeLearningWorkspaceFactory(pool, study.gateway, study.service).controller,
    metrics,
    metricsToken: environment.METRICS_BEARER_TOKEN,
    dbTimeoutMs: environment.OBSERVABILITY_DB_TIMEOUT_MS,
  });
  app.listen(environment.PORT, () =>
    console.info(`MasterMe Backend rodando na porta ${environment.PORT}`),
  );
};
