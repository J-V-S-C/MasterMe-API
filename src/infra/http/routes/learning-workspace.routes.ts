import { Router, type RequestHandler } from 'express';
import { Id, MaterialId, ReadingPosition, ShelfMaterial, ConceptId, Name, Card, Goal, GoalPatch, Plan, PlanPatch, PlanTaskOrder, TaskBoardOrder, Task, TaskPatch, Relation, Evidence, ActivityAnswer, Decision, Contestation, DeskQuery, Availability } from '../../../schemas/learning-workspace.schema';
import { authenticate } from '../../../middleware/authenticate';
import { bindAiUsageOwner } from '../../../middleware/ai-usage-context';
import { aiBurstRateLimit } from '../../../middleware/rate-limit';
import { validateRequest } from '../../../middleware/validate-request';
import type { LearningWorkspaceController } from '../../controllers/learning-workspace.controller';


const asyncRoute =
  (action: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(action(req, res, next)).catch(next);
  };

export function createLearningWorkspaceRouter(
  controller: LearningWorkspaceController,
  authenticateRequest: RequestHandler = authenticate,
): Router {
  const router = Router();
  router.use(authenticateRequest, bindAiUsageOwner);
  router.get(
    '/materials/:materialId/outline',
    validateRequest({ params: MaterialId }),
    asyncRoute(controller.outline),
  );
  router.get('/materials/:materialId/reading-position', validateRequest({ params: MaterialId }), asyncRoute(controller.readingPosition));
  router.put('/materials/:materialId/reading-position', validateRequest({ params: MaterialId, body: ReadingPosition }), asyncRoute(controller.setReadingPosition));
  router.get(
    '/materials/:materialId/relations',
    validateRequest({ params: MaterialId }),
    asyncRoute(controller.relations),
  );
  router.post(
    '/relations',
    validateRequest({ body: Relation }),
    asyncRoute(controller.createRelation),
  );
  router.get(
    '/shelves',
    asyncRoute(controller.shelves),
  );
  router.post(
    '/shelves',
    validateRequest({ body: Name }),
    asyncRoute(controller.createShelf),
  );
  router.delete(
    '/shelves/:id',
    validateRequest({ params: Id }),
    asyncRoute(controller.deleteShelf),
  );
  router.put(
    '/shelves/:id/materials/:materialId',
    validateRequest({ params: ShelfMaterial }),
    asyncRoute(controller.addShelfMaterial),
  );
  router.delete(
    '/shelves/:id/materials/:materialId',
    validateRequest({ params: ShelfMaterial }),
    asyncRoute(controller.removeShelfMaterial),
  );
  router.get(
    '/cards',
    asyncRoute(controller.cards),
  );
  router.put(
    '/cards/:conceptId',
    validateRequest({ params: ConceptId, body: Card }),
    asyncRoute(controller.saveCard),
  );
  router.delete(
    '/cards/:conceptId',
    validateRequest({ params: ConceptId }),
    asyncRoute(controller.deleteCard),
  );
  router.get(
    '/goals',
    asyncRoute(controller.goals),
  );
  router.post(
    '/goals',
    validateRequest({ body: Goal }),
    asyncRoute(controller.createGoal),
  );
  router.patch('/goals/:id', validateRequest({ params: Id, body: GoalPatch }), asyncRoute(controller.updateGoal));
  router.get(
    '/plans',
    asyncRoute(controller.plans),
  );
  router.post(
    '/plans',
    validateRequest({ body: Plan }),
    asyncRoute(controller.createPlan),
  );
  router.patch('/plans/:id', validateRequest({ params: Id, body: PlanPatch }), asyncRoute(controller.updatePlan));
  router.put('/plans/:id/tasks/order', validateRequest({ params: Id, body: PlanTaskOrder }), asyncRoute(controller.reorderPlanTasks));
  router.get(
    '/tasks',
    asyncRoute(controller.tasks),
  );
  router.put('/tasks/order', validateRequest({ body: TaskBoardOrder }), asyncRoute(controller.reorderTasks));
  router.post(
    '/tasks',
    validateRequest({ body: Task }),
    asyncRoute(controller.createTask),
  );
  router.patch(
    '/tasks/:id',
    validateRequest({ params: Id, body: TaskPatch }),
    asyncRoute(controller.updateTask),
  );
  router.get(
    '/availability',
    asyncRoute(controller.availability),
  );
  router.put(
    '/availability',
    validateRequest({ body: Availability }),
    asyncRoute(controller.setAvailability),
  );
  router.get(
    '/desk',
    validateRequest({ query: DeskQuery }),
    asyncRoute(controller.desk),
  );
  router.get(
    '/materials/:materialId/evidence',
    validateRequest({ params: MaterialId }),
    asyncRoute(controller.evidence),
  );
  router.post(
    '/evidence',
    validateRequest({ body: Evidence }),
    asyncRoute(controller.recordEvidence),
  );
  router.post(
    '/evidence/:id/contestations',
    validateRequest({ params: Id, body: Contestation }),
    asyncRoute(controller.contestEvidence),
  );
  router.post(
    '/activities/answers',
    aiBurstRateLimit,
    validateRequest({ body: ActivityAnswer }),
    asyncRoute(controller.evaluateActivity),
  );
  router.get(
    '/suggestions',
    asyncRoute(controller.suggestions),
  );
  router.post(
    '/evidence/:id/revisit',
    validateRequest({ params: Id }),
    asyncRoute(controller.requestRevisit),
  );
  router.post(
    '/suggestions/:id/decision',
    validateRequest({ params: Id, body: Decision }),
    asyncRoute(controller.decideSuggestion),
  );
  return router;
}
