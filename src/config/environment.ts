import { z } from 'zod'

const EnvironmentSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY é obrigatória.'),
  MODEL_NAME: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_MODEL_FALLBACKS: z
    .string()
    .default('gemini-3.5-flash,gemini-3.6-flash')
    .transform((value) => [...new Set(value.split(',').map((model) => model.trim()).filter(Boolean))]),
  EXTRACTION_MAX_CONCEPTS: z.coerce.number().int().min(1).max(30).default(12),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  DATABASE_URL: z.string().url(),
  MATERIAL_STORAGE_PATH: z.string().min(1).default('/app/data/materials'),
  EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
})

export type Environment = z.infer<typeof EnvironmentSchema>

export const getEnvironment = (): Environment => EnvironmentSchema.parse(process.env)
