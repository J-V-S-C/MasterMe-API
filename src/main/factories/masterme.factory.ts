import type { Pool } from 'pg';
import type { Environment } from '../../config/environment';
import type { MetricsRegistry } from '../../middleware/observability';
import type { BillingService } from '../../application/services/billing.service';
import type { IngestionService } from '../../infra/ingestion/ingestion.service';
import { GeminiStructuredClient } from '../../infra/llm/gemini-structured.client';
import { PostgresMasterMeRepository } from '../../infra/repositories/postgres/postgres-masterme.repository';
import { GeminiMasterMeGateway } from '../../infra/llm/gemini.gateway';
import { MasterMeService } from '../../application/services/masterme.service';
import { MasterMeController } from '../../infra/controllers/masterme.controller';

export function makeMasterMeService(
  pool: Pool,
  environment: Environment,
  metrics: MetricsRegistry,
  billing: BillingService,
) {
  const repository = new PostgresMasterMeRepository(pool);
  const gateway = new GeminiMasterMeGateway(new GeminiStructuredClient(
    environment,
    async (event, ownerId) => {
      metrics.recordAi(event);
      await repository.recordAiUsage(event, ownerId);
    },
    undefined,
    (ownerId, operation) => billing.reserveCredits(ownerId, operation),
  ), environment.EXTRACTION_MAX_CONCEPTS);
  const service = new MasterMeService(repository, gateway);
  return { service, gateway };
}

export function makeMasterMeFactory(
  pool: Pool,
  environment: Environment,
  metrics: MetricsRegistry,
  billing: BillingService,
  ingestion?: IngestionService,
) {
  const { service, gateway } = makeMasterMeService(pool, environment, metrics, billing);
  const controller = new MasterMeController(service, environment.AI_DAILY_REQUEST_LIMIT, ingestion);
  return { service, controller, gateway };
}
