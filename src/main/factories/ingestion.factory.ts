import type { Pool } from 'pg';
import type { Environment } from '../../config/environment';
import { IngestionService, LocalMaterialStorage } from '../../infra/ingestion/ingestion.service';
import { IngestionController } from '../../infra/controllers/masterme.controller';

export function makeIngestionService(pool: Pool, environment: Environment): IngestionService {
  return new IngestionService(pool, new LocalMaterialStorage(environment.MATERIAL_STORAGE_PATH));
}

export function makeIngestionFactory(pool: Pool, environment: Environment) {
  const service = makeIngestionService(pool, environment);
  const controller = new IngestionController(service);
  return { service, controller };
}
