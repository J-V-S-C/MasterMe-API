import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Environment } from './environment';

export type AiOperation =
  | 'EXTRACTION'
  | 'INITIAL_EVALUATION'
  | 'EDGE_CASE_GENERATION'
  | 'EDGE_CASE_EVALUATION'
  | 'PRACTICE_PROJECT'
  | 'STRESS_EVALUATION'
  | 'ISOMORPHIC_PROBLEM';
export type AiUsageEvent = {
  operation: AiOperation;
  model: string;
  success: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
};
type GenerateOptions = { operation: AiOperation; maxOutputTokens: number };
type ContentGenerator = Pick<GoogleGenAI['models'], 'generateContent'>;

// O provedor aceita apenas um subconjunto de JSON Schema. As restrições
// completas continuam sendo aplicadas localmente pelo Zod após a resposta.
const providerSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== 'object') return value;
  const supported = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'anyOf',
    'description',
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => supported.has(key))
      .map(([key, item]) => [
        key,
        key === 'properties' &&
        item &&
        typeof item === 'object' &&
        !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).map(([name, property]) => [
                name,
                providerSchema(property),
              ]),
            )
          : providerSchema(item),
      ]),
  );
};

export class GeminiStructuredClient {
  private readonly models: string[];
  private readonly quotaBlockedModels = new Set<string>();
  private readonly generator: ContentGenerator;
  public readonly extractionConcurrency: number;

  public constructor(
    environment: Environment,
    private readonly recordUsage: (
      event: AiUsageEvent,
    ) => Promise<void> = async () => undefined,
    generator?: ContentGenerator,
  ) {
    this.extractionConcurrency = environment.EXTRACTION_CONCURRENCY;
    this.models = [
      ...new Set([
        environment.MODEL_NAME,
        ...environment.GEMINI_MODEL_FALLBACKS,
      ]),
    ];
    this.generator =
      generator ??
      new GoogleGenAI({ apiKey: environment.GEMINI_API_KEY }).models;
  }

  public async generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
    options: GenerateOptions,
  ): Promise<T> {
    let lastError: unknown;

    for (const modelName of this.models) {
      if (this.quotaBlockedModels.has(modelName)) continue;
      let usageMetadata:
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
      try {
        const response = await this.generator.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            temperature: 0.1,
            maxOutputTokens: options.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: providerSchema(z.toJSONSchema(schema)),
          },
        });
        usageMetadata = response.usageMetadata;
        if (!response.text)
          throw new InvalidStructuredOutputError(
            'Gemini returned no response text',
          );
        let json: unknown;
        try {
          json = JSON.parse(response.text);
        } catch {
          throw new InvalidStructuredOutputError(
            'Gemini returned invalid JSON',
          );
        }
        const parsed = schema.parse(json);
        await this.safeRecordUsage({
          operation: options.operation,
          model: modelName,
          success: true,
          inputTokens: usageMetadata?.promptTokenCount ?? null,
          outputTokens: usageMetadata?.candidatesTokenCount ?? null,
          errorCode: null,
        });
        return parsed;
      } catch (error) {
        lastError = error;
        await this.safeRecordUsage({
          operation: options.operation,
          model: modelName,
          success: false,
          inputTokens: usageMetadata?.promptTokenCount ?? null,
          outputTokens: usageMetadata?.candidatesTokenCount ?? null,
          errorCode: classifyError(error),
        });
        if (!canUseFallback(error)) throw error;
        if (isDailyQuotaError(error) || isUnavailableModelError(error))
          this.quotaBlockedModels.add(modelName);
        console.warn(
          JSON.stringify({
            level: 'warn',
            operation: 'gemini-fallback',
            model: modelName,
            reason: errorMessage(error),
            skippedUntilRestart: this.quotaBlockedModels.has(modelName),
          }),
        );
      }
    }

    throw new Error(
      `Gemini quota or availability exhausted for all configured models: ${this.models.join(', ')}`,
      { cause: lastError },
    );
  }

  private async safeRecordUsage(event: AiUsageEvent): Promise<void> {
    try {
      await this.recordUsage(event);
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          operation: 'ai-usage-recording',
          reason: errorMessage(error),
        }),
      );
    }
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
class InvalidStructuredOutputError extends Error {}

const classifyError = (error: unknown): string => {
  const details = errorMessage(error).toLowerCase();
  if (details.includes('429') || details.includes('quota'))
    return 'QUOTA_EXHAUSTED';
  if (details.includes('404') || details.includes('model not found'))
    return 'MODEL_NOT_FOUND';
  if (details.includes('503') || details.includes('overloaded'))
    return 'MODEL_UNAVAILABLE';
  if (
    error instanceof z.ZodError ||
    error instanceof InvalidStructuredOutputError
  )
    return 'INVALID_STRUCTURED_OUTPUT';
  return 'PROVIDER_ERROR';
};

const canUseFallback = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase();
  return (
    details.includes('429') ||
    details.includes('resource_exhausted') ||
    details.includes('rate limit') ||
    details.includes('quota') ||
    details.includes('503') ||
    details.includes('overloaded') ||
    details.includes('model not found') ||
    details.includes('404') ||
    error instanceof z.ZodError ||
    error instanceof InvalidStructuredOutputError
  );
};

const isUnavailableModelError = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase();
  return (
    details.includes('404') ||
    details.includes('model not found') ||
    details.includes('no longer available')
  );
};

const isDailyQuotaError = (error: unknown): boolean => {
  const details = errorMessage(error).toLowerCase();
  return (
    details.includes('free_tier_requests') ||
    details.includes('requests per day') ||
    details.includes('daily quota') ||
    details.includes(' rpd ')
  );
};
