import { describe, expect, test } from 'bun:test';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import type { LearningWorkspaceService } from '../../../application/services/learning-workspace.service';
import { AppError } from '../../../application/errors';
import { errorHandler } from '../../../middleware/error-handler';
import { LearningWorkspaceController } from '../../controllers/learning-workspace.controller';
import { createLearningWorkspaceRouter } from './learning-workspace.routes';

const ownerId = '11111111-1111-4111-8111-111111111111';
const materialId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const suggestionId = '44444444-4444-4444-8444-444444444444';

const authenticated: RequestHandler = (_req, res, next) => {
  res.locals.userId = ownerId;
  next();
};

const withServer = async (
  methods: Partial<LearningWorkspaceService>,
  run: (baseUrl: string) => Promise<void>,
  authenticateRequest: RequestHandler = authenticated,
): Promise<void> => {
  const app = express();
  app.use(express.json());
  app.use('/api/learning', createLearningWorkspaceRouter(
    new LearningWorkspaceController(methods as LearningWorkspaceService),
    authenticateRequest,
  ));
  app.use(errorHandler);
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port is unavailable.');
  try {
    await run(`http://127.0.0.1:${address.port}/api/learning`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('learning workspace routes', () => {
  test('validates reading positions before updating an owned material', async () => {
    const calls: unknown[][] = [];
    await withServer({
      readingPosition: async () => ({ offset: 24 }),
      setReadingPosition: async (owner, material, offset) => {
        calls.push([owner, material, offset]);
        return { offset };
      },
    }, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/materials/${materialId}/reading-position`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/materials/${materialId}/reading-position`, json('PUT', { offset: -1 }))).status).toBe(400);
      const saved = await fetch(`${baseUrl}/materials/${materialId}/reading-position`, json('PUT', { offset: 12 }));
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ data: { offset: 12 } });
      expect(calls).toEqual([[ownerId, materialId, 12]]);
    });
  });

  test('validates ordered plan materials and supports editing the collection', async () => {
    const calls: unknown[][] = [];
    await withServer({
      createPlan: async (owner, input) => { calls.push([owner, input]); return { id: 'plan-1' }; },
      updatePlan: async (owner, id, input) => { calls.push([owner, id, input]); return { id }; },
    }, async (baseUrl) => {
      const invalid = await fetch(`${baseUrl}/plans`, json('POST', { title: 'Reading', materialIds: [materialId, materialId] }));
      expect(invalid.status).toBe(400);
      expect(calls).toHaveLength(0);
      expect((await fetch(`${baseUrl}/plans`, json('POST', { title: 'Reading', materialIds: [materialId] }))).status).toBe(201);
      expect((await fetch(`${baseUrl}/plans/${materialId}`, json('PATCH', { materialIds: [] }))).status).toBe(200);
      expect(calls).toEqual([
        [ownerId, { title: 'Reading', materialIds: [materialId] }],
        [ownerId, materialId, { materialIds: [] }],
      ]);
    });
  });

  test('validates a complete ordered task list before calling the service', async () => {
    const calls: unknown[][] = [];
    await withServer({
      reorderPlanTasks: async (owner, planId, taskIds) => { calls.push([owner, planId, taskIds]); return []; },
    }, async (baseUrl) => {
      const path = `${baseUrl}/plans/${materialId}/tasks/order`;
      expect((await fetch(path, json('PUT', { taskIds: [requestId, requestId] }))).status).toBe(400);
      expect(calls).toHaveLength(0);
      expect((await fetch(path, json('PUT', { taskIds: [requestId, suggestionId] }))).status).toBe(200);
      expect(calls).toEqual([[ownerId, materialId, [requestId, suggestionId]]]);
    });
  });

  test('requires authentication before calling the service', async () => {
    let calls = 0;
    await withServer({ shelves: async () => { calls += 1; return []; } }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shelves`);
      expect(response.status).toBe(401);
      expect(calls).toBe(0);
    }, (_req, _res, next) => next(new AppError('UNAUTHENTICATED', 'Sign in.')));
  });

  test('validates and trims shelf names before calling the service', async () => {
    const calls: unknown[][] = [];
    await withServer({
      createShelf: async (...args: unknown[]) => {
        calls.push(args);
        return { id: 'shelf-1', name: args[1] };
      },
    }, async (baseUrl) => {
      const invalid = await fetch(`${baseUrl}/shelves`, json('POST', { name: '   ' }));
      expect(invalid.status).toBe(400);
      expect(calls).toHaveLength(0);

      const created = await fetch(`${baseUrl}/shelves`, json('POST', { name: '  Algebra  ' }));
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ data: { id: 'shelf-1', name: 'Algebra' } });
      expect(calls).toEqual([[ownerId, 'Algebra']]);
    });
  });

  test('validates tasks and converts the scheduled time before handing it to the service', async () => {
    const calls: unknown[][] = [];
    await withServer({
      createTask: async (...args: unknown[]) => {
        calls.push(args);
        return { id: 'task-1' };
      },
    }, async (baseUrl) => {
      const invalid = await fetch(`${baseUrl}/tasks`, json('POST', {
        title: 'Read', activityType: 'READ', durationMinutes: 0,
      }));
      expect(invalid.status).toBe(400);
      expect(calls).toHaveLength(0);

      const created = await fetch(`${baseUrl}/tasks`, json('POST', {
        title: 'Read', activityType: 'READ', materialId,
        scheduledAt: '2026-10-18T10:00:00Z',
      }));
      expect(created.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe(ownerId);
      expect(calls[0]?.[1]).toMatchObject({
        title: 'Read', activityType: 'READ', materialId,
        scheduledAt: new Date('2026-10-18T10:00:00Z'),
      });
    });
  });

  test('does not let a client self-approve evidence', async () => {
    const calls: unknown[][] = [];
    await withServer({
      recordEvidence: async (...args: unknown[]) => {
        calls.push(args);
        return { event: { id: 'event-1', request_id: null }, suggestion: null };
      },
    }, async (baseUrl) => {
      const evidence = {
        materialId, activityType: 'COMPREHENSION',
        prompt: 'Explain the premise.', answer: 'It follows from the source.',
        sourceExcerpt: 'A grounded source excerpt.',
      };
      const forged = await fetch(`${baseUrl}/evidence`, json('POST', {
        ...evidence, status: 'PASSED', diagnosis: 'Approved',
      }));
      expect(forged.status).toBe(400);
      expect(calls).toHaveLength(0);

      const declared = await fetch(`${baseUrl}/evidence`, json('POST', {
        ...evidence, status: 'SELF_REPORTED',
      }));
      expect(declared.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toMatchObject({
        status: 'SELF_REPORTED', assisted: false, diagnosis: '',
      });
    });
  });

  test('validates AI answers and suggestion decisions before calling the service', async () => {
    const answerCalls: unknown[][] = [];
    const decisionCalls: unknown[][] = [];
    await withServer({
      evaluateActivity: async (...args: unknown[]) => {
        answerCalls.push(args);
        return { event: { id: 'event-1', request_id: requestId }, suggestion: null };
      },
      decideSuggestion: async (...args: unknown[]) => {
        decisionCalls.push(args);
        return { id: suggestionId, status: args[2] };
      },
    }, async (baseUrl) => {
      const shortAnswer = await fetch(`${baseUrl}/activities/answers`, json('POST', {
        requestId, activityType: 'APPLICATION', answer: 'too short',
      }));
      expect(shortAnswer.status).toBe(400);
      expect(answerCalls).toHaveLength(0);

      const answer = await fetch(`${baseUrl}/activities/answers`, json('POST', {
        requestId, activityType: 'APPLICATION', answer: 'A sufficiently detailed application answer.',
      }));
      expect(answer.status).toBe(201);
      expect(answerCalls[0]?.[1]).toMatchObject({ requestId, assisted: false });

      const invalidDecision = await fetch(`${baseUrl}/suggestions/${suggestionId}/decision`,
        json('POST', { decision: 'DONE' }));
      expect(invalidDecision.status).toBe(400);
      expect(decisionCalls).toHaveLength(0);

      const accepted = await fetch(`${baseUrl}/suggestions/${suggestionId}/decision`,
        json('POST', { decision: 'ACCEPTED' }));
      expect(accepted.status).toBe(200);
      expect(decisionCalls).toEqual([[ownerId, suggestionId, 'ACCEPTED']]);
    });
  });
});
