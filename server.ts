import dotenv from 'dotenv'
import express, { type Express } from 'express'
import { Pool } from 'pg'
import swaggerUi from 'swagger-ui-express'
import { getEnvironment, type Environment } from './src/config/environment'
import { GeminiStructuredClient } from './src/config/llm'
import { errorHandler } from './src/middleware/error-handler'
import { MetricsRegistry, requestObservability } from './src/middleware/observability'
import { globalRateLimit } from './src/middleware/rate-limit'
import { openApiDocument } from './src/docs/openapi'
import { PostgresMasterMeRepository } from './src/repositories/postgres-masterme.repository'
import { createMasterMeRouter } from './src/routes/masterme.routes'
import { GeminiMasterMeGateway } from './src/services/gemini.gateway'
import { MasterMeService } from './src/services/masterme.service'
import { IngestionService, LocalMaterialStorage, ProcessingWorker } from './src/services/ingestion.service'
import { PostgresBillingRepository } from './src/repositories/postgres-billing.repository'
import { InfinitePayClient } from './src/services/infinitepay.client'
import { BillingService } from './src/services/billing.service'
import { createBillingRouter } from './src/routes/billing.routes'
import { BillingReconciler } from './src/services/billing-reconciler'
import { metricsHandler, readinessHandler } from './src/services/operational-observability'

dotenv.config()

export const createApp = (service: MasterMeService, ingestion?: IngestionService, pool?: Pool, aiDailyLimit = 100, billing?: BillingService, triggerBillingReconciliation?: () => void, operational?: { metrics: MetricsRegistry; metricsToken?: string; dbTimeoutMs: number }): Express => {
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', 'strong')
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'same-site',
      ...(process.env.NODE_ENV === 'production' ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
    })
    next()
  })
  const metrics = operational?.metrics ?? new MetricsRegistry()
  app.use(requestObservability(metrics))
  app.use(globalRateLimit)
  app.use('/api/billing/webhooks/infinitepay', express.json({ limit: '16kb' }))
  app.use(express.json({ limit: '110kb' }))
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/ready', pool ? readinessHandler(pool, operational?.dbTimeoutMs ?? 1_000) : (_req, res) => res.status(503).json({ status: 'not_ready' }))
  app.get('/metrics', pool ? metricsHandler(pool, metrics, operational?.metricsToken, operational?.dbTimeoutMs ?? 1_000) : (_req, res) => res.status(404).json({ code: 'NOT_FOUND' }))
  if (process.env.NODE_ENV !== 'production') {
    app.get('/openapi.json', (_req, res) => res.json(openApiDocument))
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
  }
  app.use('/api', (req, res, next) => {
    const volatile = req.path === '/events' || req.path === '/ai-usage/today' || req.path === '/processing/overview' || req.path.endsWith('/status')
    if ((req.method === 'GET' || req.method === 'HEAD') && !volatile) {
      res.set('cache-control', 'private, max-age=0, must-revalidate')
      res.vary('authorization')
    } else res.set('cache-control', 'no-store')
    next()
  })
  if (billing) app.use('/api/billing', createBillingRouter(billing, undefined, triggerBillingReconciliation))
  app.use('/api', createMasterMeRouter(service, ingestion, pool, aiDailyLimit))
  app.use(errorHandler)
  return app
}

const startServer = (environment: Environment): void => {
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: environment.DATABASE_POOL_MAX }); const repository = new PostgresMasterMeRepository(pool)
  const metrics = new MetricsRegistry()
  const billingRepository = new PostgresBillingRepository(pool)
  const billing = new BillingService(
    billingRepository,
    environment.INFINITEPAY_HANDLE ? new InfinitePayClient(fetch, environment.INFINITEPAY_TIMEOUT_MS) : undefined,
    {
      publicAppUrl: environment.PUBLIC_APP_URL,
      infinitePayHandle: environment.INFINITEPAY_HANDLE,
      maxProviderAttempts: new Set([environment.MODEL_NAME, ...environment.GEMINI_MODEL_FALLBACKS]).size,
      creditPolicy: { enabled: environment.AI_CREDITS_ENABLED, globalDailyLimit: environment.AI_GLOBAL_DAILY_CREDIT_LIMIT },
    },
    metrics,
  )
  const gateway = new GeminiMasterMeGateway(
    new GeminiStructuredClient(
      environment,
      async (event, ownerId) => { metrics.recordAi(event); await repository.recordAiUsage(event, ownerId) },
      undefined,
      (ownerId, operation) => billing.reserveCredits(ownerId, operation),
    ),
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
  const billingReconciler = new BillingReconciler(billing)
  const reportBillingReconciliationFailure = () => {
    console.warn(JSON.stringify({ level: 'warn', operation: 'payment-reconciliation-drain', code: 'DRAIN_FAILED' }))
  }
  const triggerBillingReconciliation = () => {
    void billingReconciler.trigger().catch(reportBillingReconciliationFailure)
  }
  billingReconciler.start(60_000, reportBillingReconciliationFailure)
  const app = createApp(study, ingestion, pool, environment.AI_DAILY_REQUEST_LIMIT, billing, triggerBillingReconciliation, { metrics, metricsToken: environment.METRICS_BEARER_TOKEN, dbTimeoutMs: environment.OBSERVABILITY_DB_TIMEOUT_MS })
  app.listen(environment.PORT, () => {
    console.info(`MasterMe Backend rodando na porta ${environment.PORT}`)
  })
}

const isDirectExecution = import.meta.main || process.argv[1]?.endsWith('server.ts') === true
if (isDirectExecution) startServer(getEnvironment())
