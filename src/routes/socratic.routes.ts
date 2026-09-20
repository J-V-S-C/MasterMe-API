import { Router } from 'express';
import { SocraticController } from '../controllers/socratic.controller';
import { validateRequest } from '../middleware/validate-request';
import {
  AnswerBodySchema,
  CreateMaterialBodySchema,
  IdParamsSchema,
} from '../schemas/http.schema';
import type { SocraticService } from '../services/socratic.service';
import multer from 'multer';
import { IngestionController } from '../controllers/socratic.controller';
import type { IngestionService } from '../services/ingestion.service';

export const createSocraticRouter = (service: SocraticService, ingestion?: IngestionService): Router => {
  const router = Router();
  const controller = new SocraticController(service);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  if (ingestion) {
    const files = new IngestionController(ingestion);
    router.get('/events', files.events);
    router.get('/processing/overview', files.overview);
    router.post('/materials/upload', upload.single('file'), files.upload);
    router.post('/materials/:id/extract', validateRequest({ params: IdParamsSchema }), files.extract);
    router.get('/materials/:id/status', validateRequest({ params: IdParamsSchema }), files.status);
  }

  router.get('/', (_req, res) => {
    res.json({
      name: 'Socratic Game API',
      version: 'mvp',
      endpoints: [
        'GET /docs',
        'POST /api/materials',
        'GET /api/materials',
        'GET /api/materials/:id',
        'POST /api/materials/:id/extract',
        'GET /api/materials/:id/concepts',
        'GET /api/materials/:id/knowledge-map',
        'POST /api/concepts/:id/sessions',
        'GET /api/sessions/:id',
        'POST /api/sessions/:id/answers',
        'POST /api/sessions/:id/stress-replies',
        'POST /api/materials/:id/isomorphic-problem',
        'GET /api/ai-usage/today',
      ],
    });
  });

  router.post(
    '/materials',
    validateRequest({ body: CreateMaterialBodySchema }),
    controller.createMaterial,
  );
  router.get('/materials', controller.getAllMaterials);
  router.get(
    '/materials/:id',
    validateRequest({ params: IdParamsSchema }),
    controller.getMaterial,
  );
  if (!ingestion) router.post(
    '/materials/:id/extract',
    validateRequest({ params: IdParamsSchema }),
    controller.extractConcepts,
  );
  router.get(
    '/materials/:id/concepts',
    validateRequest({ params: IdParamsSchema }),
    controller.getConcepts,
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
    validateRequest({ params: IdParamsSchema, body: AnswerBodySchema }),
    controller.evaluateInitialAnswer,
  );
  router.post(
    '/sessions/:id/stress-replies',
    validateRequest({ params: IdParamsSchema, body: AnswerBodySchema }),
    controller.evaluateStressReply,
  );
  router.post(
    '/materials/:id/isomorphic-problem',
    validateRequest({ params: IdParamsSchema }),
    controller.generateIsomorphicProblem,
  );
  router.get('/ai-usage/today', controller.getAiUsageToday);

  return router;
};
