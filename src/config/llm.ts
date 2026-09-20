import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { z } from 'zod'
import type { Environment } from './environment'

export type AiOperation = 'EXTRACTION' | 'INITIAL_EVALUATION' | 'STRESS_EVALUATION' | 'ISOMORPHIC_PROBLEM'
export type AiUsageEvent = {
  operation: AiOperation
  model: string
  success: boolean
  inputTokens: number | null
  outputTokens: number | null
  errorCode: string | null
}
type GenerateOptions = { operation: AiOperation; maxOutputTokens: number }

export class GeminiStructuredClient {
  private readonly models: string[]
  private readonly quotaBlockedModels = new Set<string>()
  public readonly extractionConcurrency: number

  public constructor(
    environment: Environment,
    private readonly recordUsage: (event: AiUsageEvent) => Promise<void> = async () => undefined,
  ) {
    this.extractionConcurrency = environment.EXTRACTION_CONCURRENCY
    this.models = [...new Set([environment.MODEL_NAME, ...environment.GEMINI_MODEL_FALLBACKS].map(normalizeModelName))]
    this.apiKey = environment.GEMINI_API_KEY
  }

  private readonly apiKey: string

  public async generateStructured<T>(schema: z.ZodType<T>, prompt: string, options: GenerateOptions): Promise<T> {
    let lastError: unknown

    for (const modelName of this.models) {
      if (this.quotaBlockedModels.has(modelName)) continue
      try {
        const model = new ChatGoogleGenerativeAI({
          apiKey: this.apiKey,
          model: modelName,
          temperature: 0.1,
          maxRetries: 0,
          maxOutputTokens: options.maxOutputTokens,
        })
        // Em alguns modelos Gemini, o modo responseSchema pode devolver uma
        // resposta HTTP bem-sucedida, mas sem conteúdo parseável (parsed: null).
        // Function calling mantém o mesmo contrato Zod e retorna os argumentos
        // estruturados de forma consistente entre os modelos de fallback.
        const response = await model.withStructuredOutput(schema, {
          includeRaw: true,
          method: 'functionCalling',
          name: 'return_structured_result',
        }).invoke(prompt)
        const parsed = schema.parse(response.parsed)
        const usageMetadata = 'usage_metadata' in response.raw
          ? response.raw.usage_metadata as { input_tokens?: number; output_tokens?: number } | undefined
          : undefined
        await this.safeRecordUsage({
          operation: options.operation,
          model: modelName,
          success: true,
          inputTokens: usageMetadata?.input_tokens ?? null,
          outputTokens: usageMetadata?.output_tokens ?? null,
          errorCode: null,
        })
        return parsed
      } catch (error) {
        lastError = error
        await this.safeRecordUsage({ operation: options.operation, model: modelName, success: false, inputTokens: null, outputTokens: null, errorCode: classifyError(error) })
        if (!canUseFallback(error)) throw error
        if (isDailyQuotaError(error) || isUnavailableModelError(error)) this.quotaBlockedModels.add(modelName)
        console.warn(JSON.stringify({
          level: 'warn',
          operation: 'gemini-fallback',
          model: modelName,
          reason: errorMessage(error),
          skippedUntilRestart: this.quotaBlockedModels.has(modelName),
        }))
      }
    }

    throw new Error(`Gemini quota or availability exhausted for all configured models: ${this.models.join(', ')}`, { cause: lastError })
  }

  private async safeRecordUsage(event: AiUsageEvent): Promise<void> {
    try { await this.recordUsage(event) }
    catch (error) { console.warn(JSON.stringify({ level: 'warn', operation: 'ai-usage-recording', reason: errorMessage(error) })) }
  }
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const classifyError = (error: unknown): string => {
  const details = errorMessage(error).toLowerCase()
  if (details.includes('429') || details.includes('quota')) return 'QUOTA_EXHAUSTED'
  if (details.includes('404') || details.includes('model not found')) return 'MODEL_NOT_FOUND'
  if (details.includes('503') || details.includes('overloaded')) return 'MODEL_UNAVAILABLE'
  if (error instanceof z.ZodError || details.includes('expected object, received null')) return 'INVALID_STRUCTURED_OUTPUT'
  return 'PROVIDER_ERROR'
}

const canUseFallback = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase()
  return details.includes('429')
    || details.includes('resource_exhausted')
    || details.includes('rate limit')
    || details.includes('quota')
    || details.includes('503')
    || details.includes('overloaded')
    || details.includes('model not found')
    || details.includes('404')
    || error instanceof z.ZodError
    || details.includes('expected object, received null')
}

const isUnavailableModelError = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase()
  return details.includes('404') || details.includes('model not found') || details.includes('no longer available')
}

export const normalizeModelName = (model: string): string => {
  const aliases: Record<string, string> = {
    'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3-flash': 'gemini-3-flash-preview',
  }
  return aliases[model] ?? model
}

const isDailyQuotaError = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase()
  return details.includes('free_tier_requests')
    || details.includes('requests per day')
    || details.includes('daily quota')
    || details.includes(' rpd ')
}
