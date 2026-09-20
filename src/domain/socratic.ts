import { z } from 'zod';

export const MAX_MATERIAL_LENGTH = 100_000;

export const FragmentKindSchema = z.enum(['AXIOM', 'NODE', 'EDGE']);
export type FragmentKind = z.infer<typeof FragmentKindSchema>;

export const MaterialSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(MAX_MATERIAL_LENGTH),
  createdAt: z.string().datetime(),
});
export type StudyMaterial = z.infer<typeof MaterialSchema>;

export const QuestionSchema = z.object({
  text: z.string().min(1),
  targetPremise: z.string().min(1),
  expectedReasoningSteps: z.array(z.string().min(1)).min(1),
});
export type SocraticQuestion = z.infer<typeof QuestionSchema>;

export const ConceptSchema = z.object({
  id: z.uuid(),
  materialId: z.uuid(),
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  kind: FragmentKindSchema,
  sourceExcerpt: z.string().min(1),
  fundamentalPremises: z.array(z.string().min(1)).min(1),
  edgeCases: z.array(z.string().min(1)).min(1),
  studyQuestion: QuestionSchema.optional(),
  prerequisiteIds: z.array(z.uuid()),
  nextIds: z.array(z.uuid()),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const EvaluationStatusSchema = z.enum([
  'PASSED',
  'LOGICAL_BREAK',
  'INCOMPLETE',
]);
export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

export const EvaluationSchema = z.object({
  status: EvaluationStatusSchema,
  missingPremises: z.array(z.string()),
  logicalBreak: z.string().nullable(),
  feedback: z.string().min(1),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const StressTestSchema = z.object({
  scenario: z.string().min(1),
  edgeCaseTested: z.string().min(1),
  question: z.string().min(1),
});
export type StressTest = z.infer<typeof StressTestSchema>;

export const SessionStateSchema = z.enum([
  'QUESTION_READY',
  'RETRY_INITIAL',
  'AWAITING_STRESS_REPLY',
  'RETRY_STRESS',
  'VALIDATED',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const AttemptSchema = z.object({
  stage: z.enum(['INITIAL', 'STRESS_REPLY']),
  answer: z.string().min(1),
  evaluation: EvaluationSchema,
  createdAt: z.string().datetime(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const StudySessionSchema = z.object({
  id: z.uuid(),
  conceptId: z.uuid(),
  state: SessionStateSchema,
  question: QuestionSchema,
  stressTest: StressTestSchema.nullable(),
  attempts: z.array(AttemptSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StudySession = z.infer<typeof StudySessionSchema>;

export const IsomorphicProblemSchema = z.object({
  title: z.string().min(1),
  scenario: z.string().min(1),
  constraints: z.array(z.string().min(1)).min(1),
  responseInstruction: z.string().min(1),
});
export type IsomorphicProblem = z.infer<typeof IsomorphicProblemSchema>;
