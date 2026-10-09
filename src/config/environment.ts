import { z } from 'zod'

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY é obrigatória.'),
  MODEL_NAME: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_MODEL_FALLBACKS: z
    .string()
    .default('gemini-3.5-flash')
    .transform((value) => [...new Set(value.split(',').map((model) => model.trim()).filter(Boolean))]),
  EXTRACTION_MAX_CONCEPTS: z.coerce.number().int().min(1).max(30).default(12),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(3),
  MATERIAL_STORAGE_PATH: z.string().min(1).default('/app/data/materials'),
  EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(1),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100_000).default(100),
  AI_CREDITS_ENABLED: z.preprocess(
    (value) => value === undefined ? true : value === true || value === 'true' || value === '1',
    z.boolean(),
  ),
  AI_GLOBAL_DAILY_CREDIT_LIMIT: z.coerce.number().int().min(1).max(100_000_000).default(20_000),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000').transform((value) => value.replace(/\/$/, '')),
  INFINITEPAY_HANDLE: z.string().trim().regex(/^[A-Za-z0-9._-]{2,64}$/).optional().or(z.literal('').transform(() => undefined)),
  INFINITEPAY_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(5_000),
}).superRefine((environment, context) => {
  const appUrl = new URL(environment.PUBLIC_APP_URL)
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
    context.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'PUBLIC_APP_URL deve conter somente a origem, sem path, query ou fragmento.' })
  }
  if (environment.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'PUBLIC_APP_URL deve usar HTTPS em produção.' })
  }
})

export type Environment = z.infer<typeof EnvironmentSchema>

export const parseEnvironment = (environment: Record<string, string | undefined>): Environment => EnvironmentSchema.parse(environment)

export const getEnvironment = (): Environment => parseEnvironment(process.env)
