import type { Environment } from '../config/environment';
import { Pool } from 'pg';
import { MetricsRegistry } from '../middleware/observability';
import { ProcessingWorker } from '../infra/ingestion/ingestion.service';
import { makeBillingService } from './factories/billing.factory';
import { makeMasterMeService } from './factories/masterme.factory';
import { makeIngestionService } from './factories/ingestion.factory';

export const startWorker = (environment: Environment): void => {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: environment.DATABASE_POOL_MAX });
  const metrics = new MetricsRegistry();
  const billing = makeBillingService(pool, environment, metrics);
  const ingestion = makeIngestionService(pool, environment);
  const study = makeMasterMeService(pool, environment, metrics, billing);
  const worker = new ProcessingWorker(pool, study.service, ingestion);
  const cleanupFailureResponses = () => {
    void pool.query("UPDATE processing_jobs SET failure_responses=NULL WHERE failure_responses IS NOT NULL AND COALESCE(finished_at,updated_at) < now() - interval '30 days'")
      .catch(() => console.error(JSON.stringify({ level: 'error', operation: 'extraction-failure-response-cleanup', code: 'CLEANUP_FAILED' })));
  };
  cleanupFailureResponses();
  setInterval(cleanupFailureResponses, 24 * 60 * 60_000);
  setInterval(() => {
    void ingestion.cleanupDeletedFileOnce().catch(() => console.error(JSON.stringify({ level: 'error', operation: 'material-file-cleanup', code: 'FILE_CLEANUP_FAILED' })));
  }, 5_000);
  let active = 0;
  setInterval(() => {
    while (active < environment.EXTRACTION_CONCURRENCY) {
      active += 1;
      void worker.processOnce()
        .catch(() => console.error(JSON.stringify({ level: 'error', operation: 'processing-loop', code: 'PROCESSING_LOOP_FAILED' })))
        .finally(() => { active -= 1; });
      if (active >= environment.EXTRACTION_CONCURRENCY) break;
    }
  }, 1_000);
};
