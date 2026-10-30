import type { RequestHandler } from 'express';
import { z } from 'zod';
import { getValidated } from '../../middleware/validate-request';
import { Id, MaterialId, OutlinePatch, ReadingPosition, ShelfMaterial, ConceptId, Name, Card, Goal, GoalPatch, Plan, PlanPatch, PlanTaskOrder, TaskBoardOrder, Task, TaskPatch, Relation, Evidence, ActivityAnswer, ActivityPromptQuery, FocusedDrillQuery, Decision, Contestation, DeskQuery, TodayQuery, ReviewReminder, Availability } from '../../schemas/learning-workspace.schema';
import type { LearningWorkspaceService } from '../../application/services/learning-workspace.service';

const owner = (value: unknown): string => z.uuid().parse(value);

export class LearningWorkspaceController {
  public constructor(private readonly service: LearningWorkspaceService) {}
  public readonly activityPrompts: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.activityPrompts(owner(res.locals.userId), getValidated(res, 'params', ConceptId).conceptId, getValidated(res, 'query', ActivityPromptQuery).variant) });
  };
  public readonly questionBank: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.questionBank(owner(res.locals.userId), getValidated(res, 'params', MaterialId).materialId) });
  };
  public readonly focusedDrill: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.focusedDrill(owner(res.locals.userId), getValidated(res, 'params', MaterialId).materialId, getValidated(res, 'query', FocusedDrillQuery).conceptId) });
  };
  public readonly outline: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.outline(
          owner(res.locals.userId),
          getValidated(res, 'params', MaterialId).materialId,
        ),
      });
    };
  public readonly outlineState: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.outlineState(owner(res.locals.userId), getValidated(res, 'params', MaterialId).materialId) });
  };
  public readonly updateOutline: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.updateOutline(
      owner(res.locals.userId),
      getValidated(res, 'params', MaterialId).materialId,
      getValidated(res, 'body', OutlinePatch),
    ) });
  };
  public readonly readingPosition: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.readingPosition(owner(res.locals.userId), getValidated(res, 'params', MaterialId).materialId) });
  };
  public readonly setReadingPosition: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.setReadingPosition(
      owner(res.locals.userId),
      getValidated(res, 'params', MaterialId).materialId,
      getValidated(res, 'body', ReadingPosition).offset,
    ) });
  };
  public readonly relations: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.relations(
          owner(res.locals.userId),
          getValidated(res, 'params', MaterialId).materialId,
        ),
      });
    };
  public readonly createRelation: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.createRelation(
            owner(res.locals.userId),
            getValidated(res, 'body', Relation),
          ),
        });
    };
  public readonly shelves: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.shelves(owner(res.locals.userId)) });
    };
  public readonly createShelf: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.createShelf(
            owner(res.locals.userId),
            getValidated(res, 'body', Name).name,
          ),
        });
    };
  public readonly deleteShelf: RequestHandler = async (_req, res) => {
      await this.service.deleteShelf(
        owner(res.locals.userId),
        getValidated(res, 'params', Id).id,
      );
      res.status(204).end();
    };
  public readonly addShelfMaterial: RequestHandler = async (_req, res) => {
      const ids = getValidated(res, 'params', ShelfMaterial);
      await this.service.setShelfMaterial(
        owner(res.locals.userId),
        ids.id,
        ids.materialId,
        true,
      );
      res.status(204).end();
    };
  public readonly removeShelfMaterial: RequestHandler = async (_req, res) => {
      const ids = getValidated(res, 'params', ShelfMaterial);
      await this.service.setShelfMaterial(
        owner(res.locals.userId),
        ids.id,
        ids.materialId,
        false,
      );
      res.status(204).end();
    };
  public readonly cards: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.cards(owner(res.locals.userId)) });
    };
  public readonly saveCard: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.saveCard(
          owner(res.locals.userId),
          getValidated(res, 'params', ConceptId).conceptId,
          getValidated(res, 'body', Card).note,
        ),
      });
    };
  public readonly deleteCard: RequestHandler = async (_req, res) => {
      await this.service.deleteCard(
        owner(res.locals.userId),
        getValidated(res, 'params', ConceptId).conceptId,
      );
      res.status(204).end();
    };
  public readonly goals: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.goals(owner(res.locals.userId)) });
    };
  public readonly createGoal: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', Goal);
      res
        .status(201)
        .json({
          data: await this.service.createGoal(owner(res.locals.userId), {
            title: value.title,
            description: value.description,
            deadline: value.deadline
              ? new Date(`${value.deadline}T00:00:00Z`)
              : undefined,
          }),
        });
    };
  public readonly updateGoal: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', GoalPatch);
      res.json({ data: await this.service.updateGoal(
        owner(res.locals.userId),
        getValidated(res, 'params', Id).id,
        {
          title: value.title,
          description: value.description,
          deadline: value.deadline === undefined ? undefined : value.deadline === null ? null : new Date(`${value.deadline}T00:00:00Z`),
        },
      ) });
    };
  public readonly plans: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.plans(owner(res.locals.userId)) });
    };
  public readonly createPlan: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.createPlan(
            owner(res.locals.userId),
            getValidated(res, 'body', Plan),
          ),
        });
    };
  public readonly updatePlan: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.updatePlan(
      owner(res.locals.userId),
      getValidated(res, 'params', Id).id,
      getValidated(res, 'body', PlanPatch),
    ) });
  };
  public readonly reorderPlanTasks: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.reorderPlanTasks(
      owner(res.locals.userId),
      getValidated(res, 'params', Id).id,
      getValidated(res, 'body', PlanTaskOrder).taskIds,
    ) });
  };
  public readonly tasks: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.tasks(owner(res.locals.userId)) });
    };
  public readonly reorderTasks: RequestHandler = async (_req, res) => {
    res.json({ data: await this.service.reorderTasks(
      owner(res.locals.userId),
      getValidated(res, 'body', TaskBoardOrder).taskIds,
      getValidated(res, 'body', TaskBoardOrder).statuses,
    ) });
  };
  public readonly createTask: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', Task);
      res
        .status(201)
        .json({
          data: await this.service.createTask(owner(res.locals.userId), {
            ...value,
            scheduledAt: value.scheduledAt
              ? new Date(value.scheduledAt)
              : undefined,
          }),
        });
    };
  public readonly updateTask: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', TaskPatch);
      res.json({
        data: await this.service.updateTask(
          owner(res.locals.userId),
          getValidated(res, 'params', Id).id,
          {
            ...value,
            scheduledAt:
              value.scheduledAt === undefined
                ? undefined
                : value.scheduledAt === null
                  ? null
                  : new Date(value.scheduledAt),
          },
        ),
      });
    };
  public readonly availability: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.availability(owner(res.locals.userId)) });
    };
  public readonly setAvailability: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', Availability);
      res.json({
        data: await this.service.setAvailability(
          owner(res.locals.userId),
          value.weekday,
          value.minutes,
          value.timezone,
        ),
      });
    };
  public readonly desk: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'query', DeskQuery);
      res.json({
        data: await this.service.desk(
          owner(res.locals.userId),
          value.date,
          value.timezone,
        ),
      });
    };
  public readonly today: RequestHandler = async (_req, res) => {
    const value = getValidated(res, 'query', TodayQuery);
    res.set('cache-control', 'private, no-store');
    res.json({ data: await this.service.today(owner(res.locals.userId), value.date, value.timezone, value.availableMinutes) });
  };
  public readonly dueReviews: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.dueReviews(owner(res.locals.userId)) });
    };
  public readonly decideReviewReminder: RequestHandler = async (_req, res) => {
    const input = getValidated(res, 'body', ReviewReminder);
    res.json({ data: await this.service.decideReviewReminder(owner(res.locals.userId), getValidated(res, 'params', Id).id, input.action, input.action === 'POSTPONE' ? input.days : undefined) });
  };
  public readonly evidence: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.evidence(
          owner(res.locals.userId),
          getValidated(res, 'params', MaterialId).materialId,
        ),
      });
    };
  public readonly recordEvidence: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.recordEvidence(
            owner(res.locals.userId),
            getValidated(res, 'body', Evidence),
          ),
        });
    };
  public readonly contestEvidence: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.contestEvidence(
            owner(res.locals.userId),
            getValidated(res, 'params', Id).id,
            getValidated(res, 'body', Contestation).reason,
          ),
        });
    };
  public readonly evaluateActivity: RequestHandler = async (_req, res) => {
      res
        .status(201)
        .json({
          data: await this.service.evaluateActivity(
            owner(res.locals.userId),
            getValidated(res, 'body', ActivityAnswer),
          ),
        });
    };
  public readonly suggestions: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.suggestions(owner(res.locals.userId)) });
    };
  public readonly requestRevisit: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.requestRevisit(owner(res.locals.userId), getValidated(res, 'params', Id).id) });
    };
  public readonly decideSuggestion: RequestHandler = async (_req, res) => {
      const value = getValidated(res, 'body', Decision);
      res.json({
        data: await this.service.decideSuggestion(
          owner(res.locals.userId),
          getValidated(res, 'params', Id).id,
          { ...value, scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : undefined },
        ),
      });
    };
}
