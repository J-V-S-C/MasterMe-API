import { z } from 'zod'
import { MAX_MATERIAL_LENGTH } from '../domain/socratic'

export const CreateMaterialBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(MAX_MATERIAL_LENGTH),
})
export type CreateMaterialBody = z.infer<typeof CreateMaterialBodySchema>

export const IdParamsSchema = z.object({ id: z.string().uuid() })
export type IdParams = z.infer<typeof IdParamsSchema>

export const AnswerBodySchema = z.object({
  answer: z.string().trim().min(20).max(20_000),
})
export type AnswerBody = z.infer<typeof AnswerBodySchema>
