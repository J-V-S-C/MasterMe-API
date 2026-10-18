import { z } from 'zod';

export const Id = z.object({ id: z.uuid() });
export const MaterialId = z.object({ materialId: z.uuid() });
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
export const Plan = z.object({
  title: z.string().trim().min(1).max(160),
  goalId: z.uuid().optional(),
  materialIds: z.array(z.uuid()).max(30).refine((ids) => new Set(ids).size === ids.length).optional(),
});
export const PlanTaskOrder = z.object({ taskIds: z.array(z.uuid()).refine((ids) => new Set(ids).size === ids.length) });
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
  activityType: Activity,
  planId: z.uuid().optional(),
  materialId: z.uuid().optional(),
  conceptId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().max(500).optional(),
});
export const TaskPatch = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
    status: z.enum(['PENDING', 'DONE', 'REMOVED']).optional(),
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
});
export const Evidence = z.object({
  materialId: z.uuid(),
  conceptId: z.uuid().optional(),
  relationId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  activityType: z.enum([
    'COMPREHENSION',
    'RELATION',
    'APPLICATION',
    'RETENTION',
  ]),
  prompt: z.string().trim().min(5).max(2000),
  answer: z.string().trim().min(5).max(20_000),
  status: z.literal('SELF_REPORTED'),
  assisted: z.boolean().default(false),
  diagnosis: z.literal('').default(''),
  sourceExcerpt: z.string().min(1).max(3000),
});
export const ActivityAnswer = z.object({
  requestId: z.uuid(),
  conceptId: z.uuid().optional(),
  relationId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  activityType: z.enum([
    'COMPREHENSION',
    'RELATION',
    'APPLICATION',
    'RETENTION',
  ]),
  answer: z.string().trim().min(20).max(20_000),
  assisted: z.boolean().default(false),
});
export const Decision = z.object({ decision: z.enum(['ACCEPTED', 'IGNORED']) });
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
export const Availability = z.object({
  weekday: z.number().int().min(0).max(6),
  minutes: z.number().int().min(0).max(1440),
  timezone: Timezone,
});
