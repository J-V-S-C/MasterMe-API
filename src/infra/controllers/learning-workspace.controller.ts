import type { RequestHandler } from 'express';
import { z } from 'zod';
import { getValidated } from '../../middleware/validate-request';
import { Id, MaterialId, ShelfMaterial, ConceptId, Name, Card, Goal, Plan, Task, TaskPatch, Relation, Evidence, ActivityAnswer, Decision, Contestation, DeskQuery, Availability } from '../../schemas/learning-workspace.schema';
import type { LearningWorkspaceService } from '../../application/services/learning-workspace.service';

const owner = (value: unknown): string => z.uuid().parse(value);

export class LearningWorkspaceController {
  public constructor(private readonly service: LearningWorkspaceService) {}
  public readonly outline: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.outline(
          owner(res.locals.userId),
          getValidated(res, 'params', MaterialId).materialId,
        ),
      });
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
  public readonly tasks: RequestHandler = async (_req, res) => {
      res.json({ data: await this.service.tasks(owner(res.locals.userId)) });
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
  public readonly decideSuggestion: RequestHandler = async (_req, res) => {
      res.json({
        data: await this.service.decideSuggestion(
          owner(res.locals.userId),
          getValidated(res, 'params', Id).id,
          getValidated(res, 'body', Decision).decision,
        ),
      });
    };
}
