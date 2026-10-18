import type { EvidenceActivity, EvidenceStatus, TaskActivity } from '../domain/learning-cycle';

export interface RelationInput {
  materialId: string;
  fromConceptId: string;
  toConceptId: string;
  relationType: 'REQUIRES' | 'ENABLES' | 'CONTRASTS' | 'APPLIES_TO' | 'PART_OF';
  statement: string;
  justification: string;
  sourceExcerpt: string;
}

export interface TaskInput {
  title: string;
  activityType: TaskActivity;
  planId?: string;
  materialId?: string;
  conceptId?: string;
  unitId?: string;
  durationMinutes?: number;
  scheduledAt?: Date;
  reason?: string;
}

export interface TaskUpdate {
  title?: string;
  durationMinutes?: number | null;
  scheduledAt?: Date | null;
  status?: 'PENDING' | 'DONE' | 'REMOVED';
}

export interface GoalInput {
  title: string;
  description: string;
  deadline?: Date;
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

export type SuggestionDecision = 'ACCEPTED' | 'IGNORED';

export interface EvidenceInput {
  materialId: string;
  conceptId?: string;
  relationId?: string;
  taskId?: string;
  activityType: EvidenceActivity;
  prompt: string;
  answer: string;
  status: EvidenceStatus;
  assisted: boolean;
  diagnosis: string;
  sourceExcerpt: string;
  requestId?: string;
  leaseToken?: string;
}

export interface ActivityInput {
  requestId: string;
  conceptId?: string;
  relationId?: string;
  activityType: EvidenceActivity;
  answer: string;
  assisted: boolean;
  taskId?: string;
}
