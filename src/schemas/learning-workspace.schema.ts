import { z } from 'zod';
import { MAX_MATERIAL_TITLE_LENGTH } from '../application/material-limits';
import { MAX_QUESTION_VARIANT, MAX_STUDY_ANSWER_LENGTH, MIN_EXPLANATION_LENGTH } from '../application/study-limits';

export const Id = z.object({ id: z.uuid() });
export const MaterialId = z.object({ materialId: z.uuid() });
export const OutlinePatch = z.object({
  expectedRevision: z.number().int().nonnegative(),
  units: z.array(z.union([
    z.object({ id: z.uuid(), title: z.string().trim().min(1).max(MAX_MATERIAL_TITLE_LENGTH).nullable() }),
    z.object({ title: z.string().trim().min(1).max(MAX_MATERIAL_TITLE_LENGTH), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive() })
      .refine((unit) => unit.endOffset > unit.startOffset, { path: ['endOffset'], message: 'O fim deve vir após o início.' }),
  ])).min(1).max(3000)
    .refine((units) => { const ids = units.flatMap((unit) => 'id' in unit ? [unit.id] : []); return new Set(ids).size === ids.length; }),
});
export const ReadingPosition = z.object({ offset: z.number().int().min(0) });
export const ShelfMaterial = z.object({ id: z.uuid(), materialId: z.uuid() });
export const ConceptId = z.object({ conceptId: z.uuid() });
export const Name = z.object({ name: z.string().trim().min(1).max(80) });
export const Card = z.object({ note: z.string().max(3000) });
export const Goal = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).default(''),
  deadline: z.iso.date().optional(),
});
export const GoalPatch = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  deadline: z.iso.date().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0);
export const Plan = z.object({
  title: z.string().trim().min(1).max(160),
  goalId: z.uuid().optional(),
  materialIds: z.array(z.uuid()).max(30).refine((ids) => new Set(ids).size === ids.length).optional(),
});
export const PlanTaskOrder = z.object({ taskIds: z.array(z.uuid()).refine((ids) => new Set(ids).size === ids.length) });
export const TaskBoardOrder = PlanTaskOrder.extend({
  statuses: z.record(z.uuid(), z.enum(['PENDING', 'IN_PROGRESS', 'DONE'])).optional(),
});
export const PlanPatch = Plan.partial().extend({ goalId: z.uuid().nullable().optional() })
  .refine((value) => Object.keys(value).length > 0);
export const Activity = z.enum([
  'READ',
  'EXPLAIN',
  'RELATE',
  'APPLY',
  'REVISIT',
  'PRACTICE',
]);
export const Task = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  activityType: Activity,
  planId: z.uuid().optional(),
  materialId: z.uuid().optional(),
  conceptId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  reviewId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().max(500).optional(),
}).refine((value) => !value.projectId || (value.activityType === 'PRACTICE' && !value.reviewId), {
  message: 'Um projeto exige tarefa de prática sem revisão.', path: ['projectId'],
});
export const TaskPatch = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(500).optional(),
    materialId: z.uuid().nullable().optional(),
    conceptId: z.uuid().nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'REMOVED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const Relation = z.object({
  materialId: z.uuid(),
  fromConceptId: z.uuid(),
  toConceptId: z.uuid(),
  relationType: z.enum([
    'REQUIRES',
    'ENABLES',
    'CONTRASTS',
    'APPLIES_TO',
    'PART_OF',
  ]),
  statement: z.string().trim().min(5).max(500),
  justification: z.string().trim().min(5).max(1000),
  sourceExcerpt: z.string().min(1).max(3000),
  sourceOffset: z.number().int().nonnegative().optional(),
});
export const Evidence = z.object({
  materialId: z.uuid(),
  conceptId: z.uuid().optional(),
  relationId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  activityType: z.enum([
    'COMPREHENSION',
    'REASONING',
    'RELATION',
    'APPLICATION',
    'RETENTION',
  ]),
  prompt: z.string().trim().min(5).max(2000),
  answer: z.string().trim().min(5).max(MAX_STUDY_ANSWER_LENGTH),
  status: z.literal('SELF_REPORTED'),
  assisted: z.boolean().default(false),
  assistanceLevel: z.number().int().min(0).max(4).default(0),
  hintsUsed: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  previousEvidenceId: z.uuid().optional(),
  diagnosis: z.literal('').default(''),
  sourceExcerpt: z.string().min(1).max(3000),
  sourceOffset: z.number().int().nonnegative().optional(),
}).refine((value) => value.hintsUsed.length === 0 || value.assisted, {
  message: 'Pistas usadas exigem atividade assistida.',
  path: ['assisted'],
});
export const ActivityAnswer = z.object({
  requestId: z.uuid(),
  questionVariant: z.number().int().min(0).max(MAX_QUESTION_VARIANT).default(0),
  conceptId: z.uuid().optional(),
  relationId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  activityType: z.enum([
    'COMPREHENSION',
    'REASONING',
    'RELATION',
    'APPLICATION',
    'RETENTION',
  ]),
  attemptContext: z.enum(['STUDY', 'DRILL']).default('STUDY'),
  answer: z.string().trim().min(MIN_EXPLANATION_LENGTH).max(MAX_STUDY_ANSWER_LENGTH),
  assisted: z.boolean().default(false),
  assistanceLevel: z.number().int().min(0).max(4).default(0),
  hintsUsed: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  solutionRevealed: z.boolean().default(false),
  previousEvidenceId: z.uuid().optional(),
  reviewId: z.uuid().optional(),
}).refine((value) => value.hintsUsed.length === 0 || value.assisted, {
  message: 'Pistas usadas exigem atividade assistida.',
  path: ['assisted'],
}).refine((value) => value.activityType !== 'RELATION' && !value.relationId, {
  message: 'A avaliação de relações não está disponível.',
  path: ['activityType'],
}).refine((value) => !value.reviewId || value.activityType === 'RETENTION', {
  message: 'Uma revisão exige atividade de retomada.', path: ['activityType'],
}).refine((value) => value.attemptContext !== 'DRILL' || value.activityType === 'APPLICATION', {
  message: 'Uma prática focada exige atividade de aplicação.', path: ['activityType'],
});
export const ActivityPromptQuery = z.object({ variant: z.coerce.number().int().min(0).max(MAX_QUESTION_VARIANT).default(0) });
export const FocusedDrillQuery = z.object({ conceptId: z.uuid().optional() });
export const Decision = z.object({
  decision: z.enum(['ACCEPTED', 'IGNORED']),
  title: z.string().trim().min(1).max(160).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  planId: z.uuid().optional(),
}).refine((value) => value.decision === 'ACCEPTED' ||
  (value.title === undefined && value.durationMinutes === undefined &&
    value.scheduledAt === undefined && value.planId === undefined));
export const Contestation = z.object({ reason: z.string().trim().min(5).max(2000) });
export const Timezone = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const DeskQuery = z.object({ date: z.iso.date(), timezone: Timezone });
export const TodayQuery = DeskQuery.extend({ availableMinutes: z.coerce.number().int().min(5).max(480).optional() });
export const ReviewReminder = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('POSTPONE'), days: z.number().int().min(1).max(30) }),
  z.strictObject({ action: z.literal('SKIP') }),
]);
export const Availability = z.object({
  weekday: z.number().int().min(0).max(6),
  minutes: z.number().int().min(0).max(1440),
  timezone: Timezone,
});
