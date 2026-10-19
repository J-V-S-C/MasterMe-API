import { expect, mock, test } from 'bun:test';
import { LearningWorkspaceService } from './learning-workspace.service';
import type { LearningWorkspaceRepository, ActivityContext, ActivityOutcome, EvidenceSuggestion } from '../repositories/learning-workspace.repository';
import type { EvidenceInput } from '../contracts/learning-workspace.service';
import type { ActivityAssessmentGateway } from '../ports/activity-assessment.gateway';

const ownerId = '11111111-1111-4111-8111-111111111111';
const conceptId = '22222222-2222-4222-8222-222222222222';
const materialId = '33333333-3333-4333-8333-333333333333';
const input = {
  requestId: '44444444-4444-4444-8444-444444444444',
  conceptId,
  activityType: 'COMPREHENSION' as const,
  answer: 'The dependencies are provided by the caller.',
  assisted: false,
};
const context: ActivityContext = {
  materialId,
  conceptId,
  conceptName: 'Dependency injection',
  sourceExcerpt: 'The caller provides dependencies.',
  criteria: ['The caller chooses the implementation.'],
  locale: 'en-US',
};
const outcome: ActivityOutcome = { event: { id: 'event-1', request_id: input.requestId }, suggestion: null };

function repository(overrides: Partial<LearningWorkspaceRepository>): LearningWorkspaceRepository {
  const unused = async () => undefined;
  return {
    outline: unused, readingPosition: async () => ({ offset: 0 }),
    setReadingPosition: async (_ownerId, _materialId, offset) => ({ offset }),
    relations: unused, createRelation: unused,
    shelves: unused, createShelf: unused, deleteShelf: unused, setShelfMaterial: unused,
    cards: unused, saveCard: unused, deleteCard: unused, goals: unused, createGoal: unused, updateGoal: unused,
    plans: unused, createPlan: unused, updatePlan: unused, reorderPlanTasks: unused, tasks: unused, createTask: unused, updateTask: unused,
    availability: unused, setAvailability: unused, desk: unused, evidence: unused,
    contestEvidence: unused, suggestions: unused, requestRevisit: unused, decideSuggestion: unused,
    evidenceConceptName: async () => context.conceptName,
    loadActivityContext: async () => context,
    claimActivity: async () => ({ kind: 'CLAIMED', leaseToken: 'lease-1' }),
    recordEvidence: async () => outcome,
    releaseActivity: async () => undefined,
    ...overrides,
  };
}

test('evaluates in the material locale and accepts the legacy en-US request hash', async () => {
  const claim = mock(async (_owner: string, _request: string, _hash: string, _legacy?: string) => ({ kind: 'CLAIMED' as const, leaseToken: 'lease-1' }));
  const save = mock(async (_owner: string, _input: EvidenceInput, _suggestion: EvidenceSuggestion) => outcome);
  const assess = mock(async (_input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0]) => ({ status: 'INCOMPLETE' as const, missingPremises: [], logicalBreak: null, feedback: 'Explain the mechanism.' }));
  const service = new LearningWorkspaceService(repository({ claimActivity: claim, recordEvidence: save }), { evaluateActivity: assess });
  expect(await service.evaluateActivity(ownerId, input)).toBe(outcome);
  expect(claim).toHaveBeenCalledTimes(1);
  expect(claim.mock.calls[0]?.[2]).toMatch(/^[a-f0-9]{64}$/);
  expect(claim.mock.calls[0]?.[3]).toMatch(/^[a-f0-9]{64}$/);
  expect(claim.mock.calls[0]?.[3]).not.toBe(claim.mock.calls[0]?.[2]);
  expect(assess.mock.calls[0]?.[0]).toMatchObject({
    locale: 'en-US',
    prompt: 'Explain the mechanism of Dependency injection using the material.',
    criteria: ['Explain the concept mechanism or essential conditions using the excerpt.', 'The caller chooses the implementation.'],
  });
  expect(save.mock.calls[0]?.[1]).toMatchObject({ requestId: input.requestId, leaseToken: 'lease-1', promptVersion: 'activity-v2', criteria: ['Explain the concept mechanism or essential conditions using the excerpt.', 'The caller chooses the implementation.'] });
});

test('releases the owned lease when assessment fails', async () => {
  const release = mock(async () => undefined);
  const service = new LearningWorkspaceService(repository({ releaseActivity: release }), {
    evaluateActivity: async () => { throw new Error('Provider unavailable'); },
  });
  await expect(service.evaluateActivity(ownerId, input)).rejects.toThrow('Provider unavailable');
  expect(release).toHaveBeenCalledWith(ownerId, input.requestId, 'lease-1');
});
