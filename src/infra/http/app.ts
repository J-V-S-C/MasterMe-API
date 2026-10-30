import express, { type Express } from 'express';
import type { Pool } from 'pg';
import type { RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from '../../middleware/error-handler';
import {
  MetricsRegistry,
  requestObservability,
} from '../../middleware/observability';
import { globalRateLimit } from '../../middleware/rate-limit';
import { openApiDocument } from '../../docs/openapi';
import { createMasterMeRouter } from './routes/masterme.routes';
import { authenticate } from '../../middleware/authenticate';
import { authorizeResource } from '../../middleware/authorize-resource';
import { bindAiUsageOwner } from '../../middleware/ai-usage-context';
import type { MasterMeController } from '../controllers/masterme.controller';
import type { IngestionController } from '../controllers/ingestion.controller';
import type { BillingController } from '../controllers/billing.controller';
import { createBillingRouter } from './routes/billing.routes';
import { createLearningWorkspaceRouter } from './routes/learning-workspace.routes';
import type { LearningWorkspaceController } from '../controllers/learning-workspace.controller';
import {
  metricsHandler,
  readinessHandler,
} from './operational-observability';

export type AppDependencies = {
  study: MasterMeController;
  ingestion?: IngestionController;
  pool?: Pool;
  billing?: BillingController;
  paymentsEnabled?: boolean;
  workspace?: LearningWorkspaceController;
  metrics?: MetricsRegistry;
  metricsToken?: string;
  dbTimeoutMs?: number;
  security?: readonly [RequestHandler, RequestHandler, RequestHandler];
};

export const createApp = ({ study, ingestion, pool, billing, paymentsEnabled = true, workspace, metrics: suppliedMetrics, metricsToken, dbTimeoutMs = 1_000, security }: AppDependencies): Express => {
  const masterMeSecurity = security ?? (pool ? [authenticate, bindAiUsageOwner, authorizeResource(pool)] as const : undefined);
  if (!masterMeSecurity) throw new Error('The API requires an authorization pool or explicit security middleware.');
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'same-site',
      ...(process.env.NODE_ENV === 'production'
        ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
        : {}),
    });
    next();
  });
  const metrics = suppliedMetrics ?? new MetricsRegistry();
  app.use(requestObservability(metrics));
  app.use(globalRateLimit);
  app.use('/api/billing/webhooks/infinitepay', express.json({ limit: '16kb' }));
  app.use(express.json({ limit: '110kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get(
    '/ready',
    pool
      ? readinessHandler(pool, dbTimeoutMs)
      : (_req, res) => res.status(503).json({ status: 'not_ready' }),
  );
  app.get(
    '/metrics',
    pool
      ? metricsHandler(
          pool,
          metrics,
          metricsToken,
          dbTimeoutMs,
        )
      : (_req, res) => res.status(404).json({ code: 'NOT_FOUND' }),
  );
  if (process.env.NODE_ENV !== 'production') {
    app.get('/openapi.json', (_req, res) => res.json(openApiDocument));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }
  app.use('/api', (req, res, next) => {
    const volatile =
      req.path === '/events' ||
      req.path === '/ai-usage/today' ||
      req.path === '/processing/overview' ||
      req.path.endsWith('/status');
    if ((req.method === 'GET' || req.method === 'HEAD') && !volatile) {
      res.set('cache-control', 'private, max-age=0, must-revalidate');
      res.vary('authorization');
    } else res.set('cache-control', 'no-store');
    next();
  });
  if (billing)
    app.use(
      '/api/billing',
      createBillingRouter(billing, authenticate, paymentsEnabled),
    );
  if (workspace)
    app.use(
      '/api/learning',
      createLearningWorkspaceRouter(workspace),
    );
  app.use('/api', createMasterMeRouter(study, masterMeSecurity, ingestion, paymentsEnabled));
  app.use(errorHandler);
  return app;
};
