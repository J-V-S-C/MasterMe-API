import { z } from 'zod'
import { ConfidenceValueSchema, MAX_MATERIAL_LENGTH, PracticeFocusModeSchema, SupportedLocaleSchema } from '../domain/masterme'

export const CreateMaterialBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(MAX_MATERIAL_LENGTH),
  locale: SupportedLocaleSchema.optional(),
})
export type CreateMaterialBody = z.infer<typeof CreateMaterialBodySchema>

export const IdParamsSchema = z.object({ id: z.string().uuid() })
export type IdParams = z.infer<typeof IdParamsSchema>

export const AnswerBodySchema = z.object({
  answer: z.string().trim().min(20).max(20_000),
})
export type AnswerBody = z.infer<typeof AnswerBodySchema>

export const ConfidenceBodySchema = z.object({ value: ConfidenceValueSchema })
export type ConfidenceBody = z.infer<typeof ConfidenceBodySchema>

export const LocaleBodySchema = z.object({ locale: SupportedLocaleSchema })
export type LocaleBody = z.infer<typeof LocaleBodySchema>

export const CreatePracticeProjectBodySchema = z.object({
  focusMode: PracticeFocusModeSchema,
  conceptIds: z.array(z.string().uuid()).max(5).optional(),
}).superRefine((value, context) => {
  const ids = value.conceptIds ?? []
  if (new Set(ids).size !== ids.length)
    context.addIssue({ code: 'custom', message: 'conceptIds não pode conter IDs repetidos.', path: ['conceptIds'] })
  if (value.focusMode === 'OVERVIEW' && value.conceptIds !== undefined)
    context.addIssue({ code: 'custom', message: 'OVERVIEW não aceita conceptIds.', path: ['conceptIds'] })
  if (value.focusMode === 'MANUAL' && ids.length < 1)
    context.addIssue({ code: 'custom', message: 'MANUAL exige de 1 a 5 conceptIds distintos.', path: ['conceptIds'] })
})
export type CreatePracticeProjectBody = z.infer<typeof CreatePracticeProjectBodySchema>
