import { Router } from 'express';
import { MasterMeController } from '../controllers/masterme.controller';
import { validateRequest } from '../middleware/validate-request';
import {
  AnswerBodySchema,
  ConfidenceBodySchema,
  CreatePracticeProjectBodySchema,
  CreateMaterialBodySchema,
  IdParamsSchema,
  LocaleBodySchema,
  UploadMaterialBodySchema,
} from '../schemas/http.schema';
import type { MasterMeService } from '../services/masterme.service';
import multer from 'multer';
import { IngestionController } from '../controllers/masterme.controller';
import type { IngestionService } from '../services/ingestion.service';
import type { Pool } from 'pg';
import { authenticate } from '../middleware/authenticate';
import { authorizeResource } from '../middleware/authorize-resource';
import { bindAiUsageOwner } from '../middleware/ai-usage-context';
import { aiBurstRateLimit, uploadConcurrencyLimit, uploadDailyRateLimit, uploadRateLimit } from '../middleware/rate-limit';

export const createMasterMeRouter = (service: MasterMeService, ingestion?: IngestionService, pool?: Pool, aiDailyLimit = 100): Router => {
  const router = Router();
  const controller = new MasterMeController(service, aiDailyLimit, ingestion);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 200,
      fieldNameSize: 32,
      headerPairs: 20,
    },
  });
  if (pool) router.use(authenticate, bindAiUsageOwner, authorizeResource(pool));
  if (ingestion) {
    const files = new IngestionController(ingestion);
    router.get('/events', files.events);
    router.get('/processing/overview', files.overview);
    router.post('/materials/upload', uploadDailyRateLimit, uploadRateLimit, uploadConcurrencyLimit, upload.single('file'), validateRequest({ body: UploadMaterialBodySchema }), files.upload);
    router.post('/materials/:id/extract', aiBurstRateLimit, validateRequest({ params: IdParamsSchema }), files.extract);
    router.delete('/materials/:id/extract', validateRequest({ params: IdParamsSchema }), files.cancelExtraction);
    router.get('/materials/:id/status', validateRequest({ params: IdParamsSchema }), files.status);
  }

  router.get('/', (_req, res) => {
    res.json({
      name: 'MasterMe API',
      version: 'mvp',
      endpoints: [
        'GET /docs',
        'POST /api/materials',
        'GET /api/materials',
        'GET /api/ai-usage/today',
        'GET /api/billing/catalog',
        'POST /api/billing/checkouts',
        'POST /api/billing/orders/:id/reconcile',
        'GET /api/billing/me',
        'GET /api/materials/:id',
        'POST /api/materials/:id/extract',
        'GET /api/materials/:id/concepts',
        'POST /api/materials/:id/localize',
        'GET /api/materials/:id/knowledge-map',
        'POST /api/concepts/:id/sessions',
        'GET /api/sessions/:id',
        'POST /api/sessions/:id/answers',
        'POST /api/sessions/:id/edge-case',
        'POST /api/sessions/:id/edge-case/answers',
        'GET /api/materials/:id/confidences',
        'PUT /api/concepts/:id/confidence',
        'DELETE /api/concepts/:id/confidence',
        'GET /api/materials/:id/performance',
        'GET /api/materials/:id/practice-context',
        'POST /api/materials/:id/practice-focus',
        'POST /api/materials/:id/practice-projects',
        'GET /api/materials/:id/practice-projects',
        'GET /api/practice-projects/:id',
        'POST /api/sessions/:id/stress-replies',
        'POST /api/materials/:id/isomorphic-problem',
        'GET /api/materials/:id/isomorphic-problem',
      ],
    });
  });

  router.post(
    '/materials',
    validateRequest({ body: CreateMaterialBodySchema }),
    controller.createMaterial,
  );
  router.get('/materials', controller.getAllMaterials);
  router.get('/ai-usage/today', controller.getAiUsageToday);
  router.get(
    '/materials/:id',
    validateRequest({ params: IdParamsSchema }),
    controller.getMaterial,
  );
  if (!ingestion) router.post(
    '/materials/:id/extract',
    aiBurstRateLimit,
    validateRequest({ params: IdParamsSchema }),
    controller.extractConcepts,
  );
  router.get(
    '/materials/:id/concepts',
    validateRequest({ params: IdParamsSchema }),
    controller.getConcepts,
  );
  router.post(
    '/materials/:id/localize',
    aiBurstRateLimit,
    validateRequest({ params: IdParamsSchema, body: LocaleBodySchema }),
    controller.localizeMaterial,
  );
  router.get(
    '/materials/:id/knowledge-map',
    validateRequest({ params: IdParamsSchema }),
    controller.getKnowledgeMap,
  );
  router.post(
    '/concepts/:id/sessions',
    validateRequest({ params: IdParamsSchema }),
    controller.startSession,
  );
  router.get(
    '/sessions/:id',
    validateRequest({ params: IdParamsSchema }),
    controller.getSession,
  );
  router.post(
    '/sessions/:id/answers',
    aiBurstRateLimit,
    validateRequest({ params: IdParamsSchema, body: AnswerBodySchema }),
    controller.evaluateInitialAnswer,
  );
  router.post(
    '/sessions/:id/stress-replies',
    aiBurstRateLimit,
    validateRequest({ params: IdParamsSchema, body: AnswerBodySchema }),
    controller.evaluateStressReply,
  );
  router.post(
    '/materials/:id/isomorphic-problem',
    aiBurstRateLimit,
    validateRequest({ params: IdParamsSchema }),
    controller.generateIsomorphicProblem,
  );
  router.get(
    '/materials/:id/isomorphic-problem',
    validateRequest({ params: IdParamsSchema }),
    controller.getIsomorphicProblem,
  );
  router.post('/sessions/:id/edge-case', aiBurstRateLimit, validateRequest({ params: IdParamsSchema }), controller.requestEdgeCase);
  router.post('/sessions/:id/edge-case/answers', aiBurstRateLimit, validateRequest({ params: IdParamsSchema, body: AnswerBodySchema }), controller.evaluateEdgeCaseAnswer);
  router.get('/materials/:id/confidences', validateRequest({ params: IdParamsSchema }), controller.getConfidences);
  router.put('/concepts/:id/confidence', validateRequest({ params: IdParamsSchema, body: ConfidenceBodySchema }), controller.saveConfidence);
  router.delete('/concepts/:id/confidence', validateRequest({ params: IdParamsSchema }), controller.deleteConfidence);
  router.get('/materials/:id/performance', validateRequest({ params: IdParamsSchema }), controller.getPerformance);
  router.get('/materials/:id/practice-context', validateRequest({ params: IdParamsSchema }), controller.getPracticeContext);
  router.post('/materials/:id/practice-focus', validateRequest({ params: IdParamsSchema, body: CreatePracticeProjectBodySchema }), controller.getPracticeFocus);
  router.post('/materials/:id/practice-projects', aiBurstRateLimit, validateRequest({ params: IdParamsSchema, body: CreatePracticeProjectBodySchema }), controller.generatePracticeProject);
  router.get('/materials/:id/practice-projects', validateRequest({ params: IdParamsSchema }), controller.getPracticeProjects);
  router.get('/practice-projects/:id', validateRequest({ params: IdParamsSchema }), controller.getPracticeProject);

  return router;
};
