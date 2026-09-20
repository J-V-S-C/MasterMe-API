import dotenv from 'dotenv'
import express, { type Express } from 'express'
import { Pool } from 'pg'
import swaggerUi from 'swagger-ui-express'
import { getEnvironment, type Environment } from './src/config/environment'
import { GeminiStructuredClient } from './src/config/llm'
import { errorHandler } from './src/middleware/error-handler'
import { requestLogger } from './src/middleware/observability'
import { openApiDocument } from './src/docs/openapi'
import { PostgresSocraticRepository } from './src/repositories/postgres-socratic.repository'
import { createSocraticRouter } from './src/routes/socratic.routes'
import { GeminiSocraticGateway } from './src/services/gemini.gateway'
import { SocraticService } from './src/services/socratic.service'
import { IngestionService, LocalMaterialStorage, ProcessingWorker } from './src/services/ingestion.service'

dotenv.config()

export const createApp = (service: SocraticService, ingestion?: IngestionService): Express => {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '110kb' }))
  app.use(requestLogger)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
  app.use('/api', createSocraticRouter(service, ingestion))
  app.use(errorHandler)
  return app
}

const startServer = (environment: Environment): void => {
  const pool = new Pool({ connectionString: environment.DATABASE_URL }); const repository = new PostgresSocraticRepository(pool)
  const gateway = new GeminiSocraticGateway(
    new GeminiStructuredClient(environment, (event) => repository.recordAiUsage(event)),
    environment.EXTRACTION_MAX_CONCEPTS,
  )
  const study = new SocraticService(repository, gateway); const ingestion = new IngestionService(pool, new LocalMaterialStorage(environment.MATERIAL_STORAGE_PATH))
  const worker = new ProcessingWorker(pool, study, ingestion)
  if (process.argv.includes('--worker')) {
    setInterval(() => { void worker.processOnce() }, 1_000)
    return
  }
  const app = createApp(study, ingestion)
  app.listen(environment.PORT, () => {
    console.info(`Socratic Game Backend rodando na porta ${environment.PORT}`)
  })
}

const isDirectExecution = import.meta.main || process.argv[1]?.endsWith('server.ts') === true
if (isDirectExecution) startServer(getEnvironment())
