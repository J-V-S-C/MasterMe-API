import type { EvidenceActivity, EvidenceStatus, TaskActivity } from '../domain/learning-cycle';

export interface RelationInput {
  materialId: string;
  fromConceptId: string;
  toConceptId: string;
  relationType: 'REQUIRES' | 'ENABLES' | 'CONTRASTS' | 'APPLIES_TO' | 'PART_OF';
  statement: string;
  justification: string;
  sourceExcerpt: string;
  sourceOffset?: number;
}

export interface OutlineEdit {
  expectedRevision: number;
  units: Array<{ id: string; title: string | null; startOffset?: never; endOffset?: never } | { id?: never; title: string; startOffset: number; endOffset: number }>;
}

export interface ObjectiveQuestionRecord {
  objectiveId: string | null;
  conceptId: string;
  conceptName: string;
  objectiveText: string;
  sourceExcerpt: string;
  sourceOffset: number | null;
  sourceExtractionJobId: string | null;
  questions: Array<{ id: string; activityType: string; prompt: string; promptVersion: string; criteria: string[]; sourceExcerpt: string; sourceOffset: number | null; createdAt: string }>;
}

export interface FocusedDrillContext {
  materialId: string;
  conceptId: string;
  conceptName: string;
  objectiveId: string | null;
  objectiveText: string;
  observedGap: string | null;
  sourceExcerpt: string;
  sourceOffset: number | null;
  criteria: string[];
  locale: 'pt-BR' | 'en-US';
  previousEvidenceId: string | null;
  questionVariant: number;
}

export interface FocusedDrillPreview extends FocusedDrillContext {
  activityType: 'APPLICATION';
  prompt: string;
  estimatedMinutes: number;
}

export interface TaskInput {
  title: string;
  description?: string;
  activityType: TaskActivity;
  planId?: string;
  materialId?: string;
  conceptId?: string;
  unitId?: string;
  reviewId?: string;
  projectId?: string;
  durationMinutes?: number;
  scheduledAt?: Date;
  reason?: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  materialId?: string | null;
  conceptId?: string | null;
  projectId?: string | null;
  durationMinutes?: number | null;
  scheduledAt?: Date | null;
  status?: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'REMOVED';
}

export interface GoalInput {
  title: string;
  description: string;
  deadline?: Date;
}

export interface GoalUpdate {
  title?: string;
  description?: string;
  deadline?: Date | null;
}

export interface PlanInput {
  title: string;
  goalId?: string;
  materialIds?: string[];
}

export interface PlanUpdate {
  title?: string;
  goalId?: string | null;
  materialIds?: string[];
}

export interface SuggestionDecision {
  decision: 'ACCEPTED' | 'IGNORED';
  title?: string;
  durationMinutes?: number;
  scheduledAt?: Date;
  planId?: string;
}

export interface EvidenceInput {
  materialId: string;
  conceptId?: string;
  relationId?: string;
  taskId?: string;
  reviewId?: string;
  activityType: EvidenceActivity;
  attemptContext?: 'STUDY' | 'DRILL' | 'REVIEW';
  prompt: string;
  answer: string;
  status: EvidenceStatus;
  assisted: boolean;
  assistanceLevel?: number;
  hintsUsed?: string[];
  solutionRevealed?: boolean;
  previousEvidenceId?: string;
  promptVersion?: string;
  criteria?: string[];
  diagnosis: string;
  strength?: string | null;
  gap?: string | null;
  nextAction?: string | null;
  evidenceQuote?: string | null;
  missingPremises?: string[];
  logicalBreak?: string | null;
  sourceExcerpt: string;
  sourceOffset?: number;
  requestId?: string;
  leaseToken?: string;
}

export interface ActivityInput {
  requestId: string;
  questionVariant?: number;
  conceptId?: string;
  relationId?: string;
  activityType: EvidenceActivity;
  attemptContext?: 'STUDY' | 'DRILL';
  answer: string;
  assisted: boolean;
  assistanceLevel?: number;
  hintsUsed?: string[];
  solutionRevealed?: boolean;
  previousEvidenceId?: string;
  taskId?: string;
  reviewId?: string;
}
