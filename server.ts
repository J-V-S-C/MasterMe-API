import dotenv from 'dotenv'
import express, { type Express } from 'express'
import { Pool } from 'pg'
import swaggerUi from 'swagger-ui-express'
import { getEnvironment, type Environment } from './src/config/environment'
import { GeminiStructuredClient } from './src/config/llm'
import { errorHandler } from './src/middleware/error-handler'
import { requestLogger } from './src/middleware/observability'
import { openApiDocument } from './src/docs/openapi'
import { PostgresMasterMeRepository } from './src/repositories/postgres-masterme.repository'
import { createMasterMeRouter } from './src/routes/masterme.routes'
import { GeminiMasterMeGateway } from './src/services/gemini.gateway'
import { MasterMeService } from './src/services/masterme.service'
import { IngestionService, LocalMaterialStorage, ProcessingWorker } from './src/services/ingestion.service'

dotenv.config()

export const createApp = (service: MasterMeService, ingestion?: IngestionService): Express => {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '110kb' }))
  app.use(requestLogger)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
  app.use('/api', createMasterMeRouter(service, ingestion))
  app.use(errorHandler)
  return app
}

const startServer = (environment: Environment): void => {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: environment.DATABASE_POOL_MAX }); const repository = new PostgresMasterMeRepository(pool)
  const gateway = new GeminiMasterMeGateway(
    new GeminiStructuredClient(environment, (event) => repository.recordAiUsage(event)),
    environment.EXTRACTION_MAX_CONCEPTS,
  )
  const study = new MasterMeService(repository, gateway); const ingestion = new IngestionService(pool, new LocalMaterialStorage(environment.MATERIAL_STORAGE_PATH))
  const worker = new ProcessingWorker(pool, study, ingestion)
  if (process.argv.includes('--worker')) {
    let active = 0
    setInterval(() => {
      while (active < environment.EXTRACTION_CONCURRENCY) {
        active += 1
        void worker.processOnce()
          .catch((error) => console.error(JSON.stringify({ level: 'error', operation: 'processing-loop', error: String(error) })))
          .finally(() => { active -= 1 })
        // Cada execução reivindica no máximo um job. O limite acima impede que
        // o setInterval crie promessas ilimitadas enquanto o provedor demora.
        if (active >= environment.EXTRACTION_CONCURRENCY) break
      }
    }, 1_000)
    return
  }
  const app = createApp(study, ingestion)
  app.listen(environment.PORT, () => {
    console.info(`MasterMe Backend rodando na porta ${environment.PORT}`)
  })
}

const isDirectExecution = import.meta.main || process.argv[1]?.endsWith('server.ts') === true
if (isDirectExecution) startServer(getEnvironment())
