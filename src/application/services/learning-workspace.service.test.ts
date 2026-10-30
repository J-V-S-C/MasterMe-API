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
const generated = {
  explanation: { text: 'How does the caller provide dependencies in the source?', targetPremise: 'Caller provides dependencies.', expectedReasoningSteps: ['Identify caller', 'Explain provision'], learningObjective: 'Explain dependency provision.', requiredIdeas: ['Caller', 'Provision'], commonMisconceptions: [] },
  reasoning: 'Why does providing dependencies externally change the caller relationship?',
  application: 'How would you apply external dependency provision to a small module?',
  challenge: 'How would this mechanism behave if the caller cannot provide a dependency?',
  retention: 'Without looking at the source, explain how the caller supplies dependencies.',
  practice: 'Build a small module that receives a dependency from its caller.',
};
const questions = { getQuestionBundle: mock(async (_conceptId: string, _variant = 0) => generated) };

function repository(overrides: Partial<LearningWorkspaceRepository>): LearningWorkspaceRepository {
  const unused = async () => undefined;
  return {
    outline: unused, questionBank: async () => [], focusedDrillContext: async () => ({ materialId, conceptId, conceptName: context.conceptName, objectiveId: null, objectiveText: 'Explain the mechanism.', observedGap: null, sourceExcerpt: context.sourceExcerpt, sourceOffset: null, criteria: context.criteria, locale: 'en-US', previousEvidenceId: null, questionVariant: 0 }), outlineState: unused, updateOutline: unused, readingPosition: async () => ({ offset: 0 }),
    setReadingPosition: async (_ownerId, _materialId, offset) => ({ offset }),
    relations: unused, createRelation: unused,
    shelves: unused, createShelf: unused, deleteShelf: unused, setShelfMaterial: unused,
    cards: unused, saveCard: unused, deleteCard: unused, goals: unused, createGoal: unused, updateGoal: unused,
    plans: unused, createPlan: unused, updatePlan: unused, reorderPlanTasks: unused, reorderTasks: unused, tasks: unused, createTask: unused, updateTask: unused,
    availability: unused, setAvailability: unused, desk: unused, todayCandidates: async () => ({ availableMinutes: 30, candidates: [] }), evidence: unused,
    dueReviews: async () => [],
    decideReviewReminder: unused,
    contestEvidence: unused, suggestions: unused, requestRevisit: unused, decideSuggestion: unused,
    evidenceConceptName: async () => context.conceptName,
    loadActivityContext: async () => context,
    claimActivity: async () => ({ kind: 'CLAIMED', leaseToken: 'lease-1' }),
    recordEvidence: async () => outcome,
    releaseActivity: async () => undefined,
    ...overrides,
  };
}

test('evaluates in the material locale using the generated question', async () => {
  const claim = mock(async (_owner: string, _request: string, _hash: string, _legacy?: string) => ({ kind: 'CLAIMED' as const, leaseToken: 'lease-1' }));
  const save = mock(async (_owner: string, _input: EvidenceInput, _suggestion: EvidenceSuggestion) => outcome);
  const assess = mock(async (_input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0]) => ({ status: 'INCOMPLETE' as const, missingPremises: [], logicalBreak: null, feedback: 'Explain the mechanism.' }));
  const service = new LearningWorkspaceService(repository({ claimActivity: claim, recordEvidence: save }), { evaluateActivity: assess }, questions);
  expect(await service.evaluateActivity(ownerId, input)).toBe(outcome);
  expect(claim).toHaveBeenCalledTimes(1);
  expect(claim.mock.calls[0]?.[2]).toMatch(/^[a-f0-9]{64}$/);
  expect(claim.mock.calls[0]?.[3]).toBeUndefined();
  expect(assess.mock.calls[0]?.[0]).toMatchObject({
    locale: 'en-US',
    prompt: generated.explanation.text,
    criteria: ['Explain the concept mechanism or essential conditions using the excerpt.', 'The caller chooses the implementation.'],
  });
  expect(save.mock.calls[0]?.[1]).toMatchObject({ requestId: input.requestId, leaseToken: 'lease-1', promptVersion: 'question-bundle-v3-variant0', criteria: ['Explain the concept mechanism or essential conditions using the excerpt.', 'The caller chooses the implementation.'] });
});

test('rejects legacy relation assessment before a template or model is used', async () => {
  const assess = mock(async (_input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0]) => ({ status: 'INCOMPLETE' as const, missingPremises: [], logicalBreak: null, feedback: '' }));
  const load = mock(async () => context);
  const service = new LearningWorkspaceService(repository({ loadActivityContext: load }), { evaluateActivity: assess }, questions);
  await expect(service.evaluateActivity(ownerId, { ...input, activityType: 'RELATION', relationId: conceptId })).rejects.toThrow('relações');
  expect(load).not.toHaveBeenCalled();
  expect(assess).not.toHaveBeenCalled();
});

test('previews the exact application and recall prompts used by assessment', async () => {
  const service = new LearningWorkspaceService(repository({ loadActivityContext: async () => ({ ...context, studyQuestion: 'Why does the caller provide dependencies?' }) }), undefined, questions);
  expect(await service.activityPrompts(ownerId, conceptId)).toEqual({
    reasoning: generated.reasoning,
    application: generated.application,
    retention: generated.retention,
  });
});

test('records a different, versioned prompt for a drill retry', async () => {
  const save = mock(async (_owner: string, _input: EvidenceInput, _suggestion: EvidenceSuggestion) => outcome);
  const assess = mock(async (_input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0]) => ({ status: 'INCOMPLETE' as const, missingPremises: [], logicalBreak: null, feedback: 'Explain the changed condition.' }));
  const service = new LearningWorkspaceService(repository({ recordEvidence: save }), { evaluateActivity: assess }, questions);
  const preview = await service.activityPrompts(ownerId, conceptId, 1);
  await service.evaluateActivity(ownerId, { ...input, activityType: 'APPLICATION', attemptContext: 'DRILL', questionVariant: 1, previousEvidenceId: '55555555-5555-4555-8555-555555555555' });
  expect(assess.mock.calls[0]?.[0].prompt).toBe(generated.practice);
  expect(preview.application).toBe(generated.application);
  expect(save.mock.calls[0]?.[1]).toMatchObject({ attemptContext: 'DRILL', promptVersion: 'question-bundle-v3-variant1', previousEvidenceId: '55555555-5555-4555-8555-555555555555' });
});

test('focused drill preview states the objective, gap, criterion and exact server prompt', async () => {
  const service = new LearningWorkspaceService(repository({ focusedDrillContext: async () => ({ materialId, conceptId, conceptName: context.conceptName, objectiveId: 'objective-1', objectiveText: 'Explain dependency injection.', observedGap: 'Missed the caller role.', sourceExcerpt: context.sourceExcerpt, sourceOffset: 4, criteria: context.criteria, locale: 'en-US', previousEvidenceId: 'attempt-1', questionVariant: 1 }) }), undefined, questions);
  const preview = await service.focusedDrill(ownerId, materialId, conceptId);
  expect(preview).toMatchObject({ conceptId, objectiveId: 'objective-1', observedGap: 'Missed the caller role.', activityType: 'APPLICATION', questionVariant: 1, estimatedMinutes: 10 });
  expect(preview.prompt).toBe(generated.practice);
  expect(preview.criteria).toContain('The caller chooses the implementation.');
});

test('rejects mismatched drill and review activity types before model evaluation', async () => {
  const assess = mock(async (_input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0]) => ({ status: 'INCOMPLETE' as const, missingPremises: [], logicalBreak: null, feedback: 'Missing.' }));
  const service = new LearningWorkspaceService(repository({}), { evaluateActivity: assess });
  await expect(service.evaluateActivity(ownerId, { ...input, activityType: 'REASONING', attemptContext: 'DRILL' })).rejects.toThrow('aplicação');
  await expect(service.evaluateActivity(ownerId, { ...input, activityType: 'APPLICATION', reviewId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow('retomada');
  expect(assess).not.toHaveBeenCalled();
});

test('releases the owned lease when assessment fails', async () => {
  const release = mock(async () => undefined);
  const service = new LearningWorkspaceService(repository({ releaseActivity: release }), {
    evaluateActivity: async () => { throw new Error('Provider unavailable'); },
  }, questions);
  await expect(service.evaluateActivity(ownerId, input)).rejects.toThrow('Provider unavailable');
  expect(release).toHaveBeenCalledWith(ownerId, input.requestId, 'lease-1');
});
