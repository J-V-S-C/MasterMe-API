import type { suggestNextAction } from '../domain/learning-cycle';
import type { SupportedLocale } from '../domain/material';
import type { ActivityInput, EvidenceInput, GoalInput, PlanInput, PlanUpdate, RelationInput, SuggestionDecision, TaskInput, TaskUpdate } from '../contracts/learning-workspace.service';

export interface ActivityOutcome {
  event: { id: string; request_id: string | null };
  suggestion: unknown;
}

export type EvidenceSuggestion = ReturnType<typeof suggestNextAction>;

export interface ActivityContext {
  materialId: string;
  conceptId?: string;
  conceptName: string;
  sourceExcerpt: string;
  criteria: string[];
  studyQuestion?: string;
  relation?: { sourceName: string; targetName: string };
  locale: SupportedLocale;
}

export type ActivityClaim =
  | { kind: 'REPLAY'; outcome: ActivityOutcome }
  | { kind: 'CLAIMED'; leaseToken: string };

export interface LearningWorkspaceRepository {
  outline(ownerId: string, materialId: string): Promise<unknown>;
  readingPosition(ownerId: string, materialId: string): Promise<{ offset: number }>;
  setReadingPosition(ownerId: string, materialId: string, offset: number): Promise<{ offset: number }>;
  relations(ownerId: string, materialId: string): Promise<unknown>;
  createRelation(ownerId: string, input: RelationInput): Promise<unknown>;
  shelves(ownerId: string): Promise<unknown>;
  createShelf(ownerId: string, name: string): Promise<unknown>;
  deleteShelf(ownerId: string, id: string): Promise<void>;
  setShelfMaterial(ownerId: string, shelfId: string, materialId: string, included: boolean): Promise<void>;
  cards(ownerId: string): Promise<unknown>;
  saveCard(ownerId: string, conceptId: string, note: string): Promise<unknown>;
  deleteCard(ownerId: string, conceptId: string): Promise<void>;
  goals(ownerId: string): Promise<unknown>;
  createGoal(ownerId: string, input: GoalInput): Promise<unknown>;
  plans(ownerId: string): Promise<unknown>;
  createPlan(ownerId: string, input: PlanInput): Promise<unknown>;
  updatePlan(ownerId: string, id: string, input: PlanUpdate): Promise<unknown>;
  reorderPlanTasks(ownerId: string, planId: string, taskIds: string[]): Promise<unknown>;
  tasks(ownerId: string): Promise<unknown>;
  createTask(ownerId: string, input: TaskInput): Promise<unknown>;
  updateTask(ownerId: string, id: string, input: TaskUpdate): Promise<unknown>;
  availability(ownerId: string): Promise<unknown>;
  setAvailability(ownerId: string, weekday: number, minutes: number, timezone: string): Promise<unknown>;
  desk(ownerId: string, localDate: string, timezone: string): Promise<unknown>;
  evidence(ownerId: string, materialId: string): Promise<unknown>;
  contestEvidence(ownerId: string, evidenceId: string, reason: string): Promise<unknown>;
  evidenceConceptName(ownerId: string, materialId: string, conceptId?: string): Promise<string>;
  recordEvidence(ownerId: string, input: EvidenceInput, suggestion: EvidenceSuggestion): Promise<ActivityOutcome>;
  loadActivityContext(ownerId: string, input: ActivityInput): Promise<ActivityContext>;
  claimActivity(ownerId: string, requestId: string, inputHash: string, legacyHash?: string): Promise<ActivityClaim>;
  releaseActivity(ownerId: string, requestId: string, leaseToken: string): Promise<void>;
  suggestions(ownerId: string): Promise<unknown>;
  decideSuggestion(ownerId: string, id: string, decision: SuggestionDecision): Promise<unknown>;
}
