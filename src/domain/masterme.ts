import { z } from 'zod';

export const MAX_MATERIAL_LENGTH = 100_000;

export const SupportedLocaleSchema = z.enum(['pt-BR', 'en-US']);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;
export const GeneratedLocaleSchema = z.enum(['pt-BR', 'en-US', 'und']);
export type GeneratedLocale = z.infer<typeof GeneratedLocaleSchema>;

export const FragmentKindSchema = z.enum(['AXIOM', 'NODE', 'EDGE']);
export type FragmentKind = z.infer<typeof FragmentKindSchema>;

export const MaterialSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  content: z.string().min(1),
  locale: SupportedLocaleSchema.default('pt-BR'),
  createdAt: z.string().datetime(),
});
export type StudyMaterial = z.infer<typeof MaterialSchema>;
export const MaterialSummarySchema = MaterialSchema.omit({ content: true });
export type MaterialSummary = z.infer<typeof MaterialSummarySchema>;

export const QuestionSchema = z.object({
  text: z.string().min(1),
  targetPremise: z.string().min(1),
  expectedReasoningSteps: z.array(z.string().min(1)).min(1),
  learningObjective: z.string().min(1).optional(),
  requiredIdeas: z.array(z.string().min(1)).min(1).optional(),
  commonMisconceptions: z.array(z.string().min(1)).optional(),
});
export type MasterMeQuestion = z.infer<typeof QuestionSchema>;

export const ConceptSchema = z.object({
  id: z.uuid(),
  materialId: z.uuid(),
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  kind: FragmentKindSchema,
  sourceExcerpt: z.string().min(1),
  fundamentalPremises: z.array(z.string().min(1)).min(1),
  edgeCases: z.array(z.string().min(1)).min(1),
  edgeCaseQuestion: z.string().min(1).optional(),
  studyQuestion: QuestionSchema.optional(),
  generatedLocale: GeneratedLocaleSchema.default('pt-BR'),
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
  strength: z.string().min(1).optional(),
  gap: z.string().min(1).nullable().optional(),
  nextAction: z.string().min(1).optional(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const EdgeCaseChallengeSchema = z.object({
  scenario: z.string().min(1),
  edgeCaseTested: z.string().min(1),
  question: z.string().min(1),
});
export type EdgeCaseChallenge = z.infer<typeof EdgeCaseChallengeSchema>;
export const StressTestSchema = EdgeCaseChallengeSchema;
export type StressTest = EdgeCaseChallenge;

export const EdgeCaseStatusSchema = z.enum(['NOT_REQUESTED', 'READY', 'REVIEW', 'PASSED']);
export type EdgeCaseStatus = z.infer<typeof EdgeCaseStatusSchema>;

export const SessionStateSchema = z.enum([
  'QUESTION_READY',
  'RETRY_INITIAL',
  'EXPLANATION_PASSED',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const AttemptSchema = z.object({
  stage: z.enum(['INITIAL', 'EDGE_CASE_REPLY', 'STRESS_REPLY']),
  answer: z.string().min(1),
  evaluation: EvaluationSchema,
  createdAt: z.string().datetime(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const StudySessionSchema = z.object({
  id: z.uuid(),
  conceptId: z.uuid(),
  version: z.number().int().positive(),
  state: SessionStateSchema,
  question: QuestionSchema,
  edgeCaseStatus: EdgeCaseStatusSchema,
  edgeCaseChallenge: EdgeCaseChallengeSchema.nullable(),
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

export const ConfidenceValueSchema = z.number().int().min(1).max(5);
export const ConceptConfidenceSchema = z.object({
  conceptId: z.uuid(),
  value: ConfidenceValueSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConceptConfidence = z.infer<typeof ConceptConfidenceSchema>;

export const ConceptPerformanceSchema = z.object({
  conceptId: z.uuid(),
  passedAttempts: z.number().int().nonnegative(),
  logicalBreaks: z.number().int().nonnegative(),
  incompleteAttempts: z.number().int().nonnegative(),
  totalInitialAttempts: z.number().int().nonnegative(),
  failedInitialAttempts: z.number().int().nonnegative(),
  weakness: z.number().min(0).max(1).nullable(),
  latestStatus: EvaluationStatusSchema.nullable().default(null),
  performanceNeed: z.number().min(0).max(1).nullable().default(null),
});
export type ConceptPerformance = z.infer<typeof ConceptPerformanceSchema>;

export const PracticeFocusModeSchema = z.enum(['OVERVIEW', 'MANUAL', 'CONFIDENCE', 'PERFORMANCE', 'COMBINED']);
export type PracticeFocusMode = z.infer<typeof PracticeFocusModeSchema>;

export const PrioritizedConceptSchema = z.object({
  conceptId: z.uuid(),
  name: z.string().min(1).max(160),
  reason: z.string().min(1).max(500),
});
export type PrioritizedConcept = z.infer<typeof PrioritizedConceptSchema>;

export const PracticeProjectContentSchema = z.object({
  title: z.string().min(1).max(160),
  context: z.string().min(1).max(500),
  goal: z.string().min(1).max(300),
  deliverables: z.array(z.string().min(1).max(240)).min(1).max(4),
  constraints: z.array(z.string().min(1).max(240)).min(1).max(4),
  firstStep: z.string().min(1).max(300),
});
export type PracticeProjectContent = z.infer<typeof PracticeProjectContentSchema>;

export const PracticeProjectSchema = PracticeProjectContentSchema.extend({
  id: z.uuid(),
  materialId: z.uuid(),
  prioritizedConcepts: z.array(PrioritizedConceptSchema).min(1),
  focusMode: PracticeFocusModeSchema,
  createdAt: z.string().datetime(),
});
export type PracticeProject = z.infer<typeof PracticeProjectSchema>;
