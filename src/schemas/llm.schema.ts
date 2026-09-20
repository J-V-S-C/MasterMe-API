import { z } from 'zod'
import {
  EvaluationSchema,
  FragmentKindSchema,
  IsomorphicProblemSchema,
  QuestionSchema,
  StressTestSchema,
} from '../domain/socratic'

export const ExtractedFragmentSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  kind: FragmentKindSchema,
  sourceExcerpt: z.string().min(1),
  fundamentalPremises: z.array(z.string().min(1)).min(1),
  edgeCases: z.array(z.string().min(1)).min(1),
  studyQuestion: QuestionSchema,
  prerequisiteNames: z.array(z.string().min(1)),
})

export const ExtractedKnowledgeSchema = z.object({
  fragments: z.array(ExtractedFragmentSchema).min(1).max(30),
})
export type ExtractedKnowledge = z.infer<typeof ExtractedKnowledgeSchema>

// These schemas go to Gemini. Keep them deliberately shallow: Gemini can reject
// response schemas with nested limits/constraints before it evaluates the prompt.
export const ExtractedFragmentResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: FragmentKindSchema,
  sourceParagraphId: z.string(),
  fundamentalPremises: z.array(z.string()),
  edgeCases: z.array(z.string()),
  questionText: z.string(),
  targetPremise: z.string(),
  expectedReasoningSteps: z.array(z.string()),
})
export const ChunkExtractionResponseSchema = z.object({
  fragments: z.array(ExtractedFragmentResponseSchema),
})
export type ChunkExtractionResponse = z.infer<typeof ChunkExtractionResponseSchema>

export const SinglePassKnowledgeResponseSchema = z.object({
  fragments: z.array(ExtractedFragmentResponseSchema.extend({
    prerequisiteNames: z.array(z.string()),
  })),
})
export type SinglePassKnowledgeResponse = z.infer<typeof SinglePassKnowledgeResponseSchema>

export const ReducedKnowledgeResponseSchema = z.object({
  fragments: z.array(z.object({
    name: z.string(),
    prerequisiteNames: z.array(z.string()),
  })),
})
export type ReducedKnowledgeResponse = z.infer<typeof ReducedKnowledgeResponseSchema>

export { EvaluationSchema, IsomorphicProblemSchema, QuestionSchema, StressTestSchema }
