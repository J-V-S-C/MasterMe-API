import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Environment } from '../../config/environment';
import { currentAiUsageOwner } from '../context/ai-usage-context';
import type { AiOperation } from '../../application/domain/billing';
import type { AiUsageEvent } from '../../application/ports/llm.gateway';

type GenerateOptions = { operation: AiOperation; maxOutputTokens: number; maxModelAttempts?: number };
type ContentGenerator = Pick<GoogleGenAI['models'], 'generateContent'>;

// Provider limits for the two configured models:
// gemini-3.5-flash-lite: 15 RPM, 250K TPM, 500 RPD
// gemini-3.6-flash:       5 RPM, 250K TPM,  20 RPD
// Extraction starts at three requests per minute. That is below both RPM
// ceilings and keeps a 100K-character prompt plus its output well below TPM.
const DEFAULT_EXTRACTION_REQUESTS_PER_MINUTE = 3;
const EXTRACTION_OUTPUT_TOKEN_RESERVE = 6_000;
const PROVIDER_TPM_BUDGET = 200_000;
const TOKEN_WINDOW_MS = 60_000;
const DEFAULT_MINUTE_RETRY_MS = 65_000;
const RETRY_BUFFER_MS = 5_000;
const DAILY_RESET_BUFFER_MS = 60 * 60_000;
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

export type ProviderFailureKind =
  | 'minute'
  | 'day'
  | 'model_not_found'
  | 'unavailable'
  | 'invalid_output'
  | 'other';

export type ProviderFailure = {
  kind: ProviderFailureKind;
  retryAfterMs?: number;
  status?: number;
};

export class ProviderUnavailableError extends Error {
  public constructor(
    message: string,
    public readonly failure: ProviderFailure,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

// The provider supports only a subset of JSON Schema. Zod still enforces
// the complete constraints locally after the response.
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

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

class InvalidStructuredOutputError extends Error {}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getHttpStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' && Number.isInteger(status)
    ? status
    : undefined;
};

const parseErrorBody = (error: unknown): unknown => {
  const text = errorMessage(error);
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
};

type QuotaSignal = {
  daily: boolean;
  minute: boolean;
  retryAfterMs?: number;
};

const parseDurationMs = (value: string): number | undefined => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  if (!match) return undefined;
  const seconds = Number(match[1] ?? '');
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : undefined;
};

const collectQuotaSignals = (value: unknown, signal: QuotaSignal): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectQuotaSignals(item, signal);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (/(?:perday|per_day|requestsperday|daily quota|\brpd\b)/.test(lower))
        signal.daily = true;
      if (/(?:perminute|per_minute|requestsperminute|tokensperminute|\brpm\b)/.test(lower))
        signal.minute = true;
      if (lowerKey === 'retrydelay') {
        const retryAfterMs = parseDurationMs(item);
        if (retryAfterMs !== undefined) signal.retryAfterMs = retryAfterMs;
      }
    } else {
      collectQuotaSignals(item, signal);
    }
  }
};

const pacificParts = (date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
};

/** Milliseconds until the next midnight in the provider's quota timezone. */
const millisecondsUntilNextDailyReset = (now = new Date()): number => {
  const parts = pacificParts(now);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const pacificOffset = asUtc - now.getTime();
  const nextMidnightAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + 1,
    0,
    0,
    0,
  );
  const remaining = nextMidnightAsUtc - pacificOffset - now.getTime();
  return Math.max(60_000, remaining) + DAILY_RESET_BUFFER_MS;
};

const quotaSignalFromMessage = (message: string): QuotaSignal => {
  const lower = message.toLowerCase();
  return {
    daily: /(?:requests?\s*per\s*day|requestsperday|daily quota|\brpd\b)/.test(lower),
    minute: /(?:requests?\s*per\s*minute|requestsperminute|tokens?\s*per\s*minute|\brpm\b|resource_exhausted|rate limit)/.test(lower),
  };
};

/**
 * Classifies a provider failure without trusting a single status code.
 * Google returns 429 for both per-minute and per-day limits; the quotaId in
 * the error body is the only reliable discriminator.
 */
export const classifyProviderError = (
  error: unknown,
  depth = 0,
): ProviderFailure => {
  if (depth > 4) return { kind: 'other' };
  if (error instanceof ProviderUnavailableError) return error.failure;

  const status = getHttpStatus(error);
  const message = errorMessage(error);
  const signal: QuotaSignal = quotaSignalFromMessage(message);
  const body = parseErrorBody(error);
  if (body) collectQuotaSignals(body, signal);

  if (signal.daily) {
    return {
      kind: 'day',
      retryAfterMs: signal.retryAfterMs !== undefined
        ? signal.retryAfterMs + RETRY_BUFFER_MS
        : millisecondsUntilNextDailyReset(),
      status,
    };
  }
  if (signal.minute) {
    return {
      kind: 'minute',
      retryAfterMs: (signal.retryAfterMs ?? DEFAULT_MINUTE_RETRY_MS) + RETRY_BUFFER_MS,
      status,
    };
  }
  if (error instanceof Error && error.cause) {
    const caused = classifyProviderError(error.cause, depth + 1);
    if (caused.kind !== 'other') return caused;
  }
  if (
    status === 404 ||
    message.toLowerCase().includes('model not found') ||
    message.toLowerCase().includes('no longer available')
  ) {
    return { kind: 'model_not_found', status };
  }
  if (
    status === 503 ||
    message.toLowerCase().includes('overloaded') ||
    message.toLowerCase().includes('unavailable') ||
    message.toLowerCase().includes('availability exhausted')
  ) {
    return { kind: 'unavailable', status };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof InvalidStructuredOutputError
  ) {
    return { kind: 'invalid_output', status };
  }
  if (status === 429 || message.toLowerCase().includes('429') || message.toLowerCase().includes('quota')) {
    return { kind: 'minute', retryAfterMs: DEFAULT_MINUTE_RETRY_MS + RETRY_BUFFER_MS, status };
  }
  return { kind: 'other', status };
};

export const isDailyQuotaError = (error: unknown): boolean =>
  classifyProviderError(error).kind === 'day';

export const isMinuteRateLimitError = (error: unknown): boolean =>
  classifyProviderError(error).kind === 'minute';

export class GeminiStructuredClient {
  private readonly models: string[];
  private readonly blockedModels = new Map<
    string,
    { until: number; failure: ProviderFailure }
  >();
  private readonly extractionIntervalMs: number;
  private nextExtractionRequestAt = 0;
  private extractionPaceChain: Promise<void> = Promise.resolve();
  private readonly extractionTokenWindow: Array<{
    at: number;
    tokens: number;
  }> = [];
  private readonly generator: ContentGenerator;
  public readonly extractionConcurrency: number;

  public constructor(
    environment: Environment,
    private readonly recordUsage: (
      event: AiUsageEvent,
      ownerId: string,
    ) => Promise<void> = async () => undefined,
    generator?: ContentGenerator,
    private readonly reserveCredits: (
      ownerId: string,
      operation: AiOperation,
    ) => Promise<void> = async () => undefined,
  ) {
    this.extractionConcurrency = environment.EXTRACTION_CONCURRENCY;
    this.extractionIntervalMs = Math.ceil(
      60_000 /
        (environment.EXTRACTION_REQUESTS_PER_MINUTE ??
          DEFAULT_EXTRACTION_REQUESTS_PER_MINUTE),
    );
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
    let lastFailure: ProviderFailure | undefined;

    for (const modelName of this.models.slice(0, options.maxModelAttempts ?? this.models.length)) {
      const blocked = this.blockedModels.get(modelName);
      if (blocked) {
        if (blocked.until > Date.now()) {
          if (
            options.operation === 'EXTRACTION' &&
            (blocked.failure.kind === 'minute' || blocked.failure.kind === 'day')
          ) {
            // Do not move extraction to a model with a smaller daily budget
            // while the primary is inside a quota window. The worker will
            // retry after the reported delay instead.
            throw new ProviderUnavailableError(
              `Gemini model ${modelName} is temporarily quota-blocked.`,
              blocked.failure,
            );
          }
          lastFailure ??= blocked.failure;
          continue;
        }
        this.blockedModels.delete(modelName);
      }
      if (options.operation === 'EXTRACTION') await this.paceExtraction(prompt);
      const ownerId = currentAiUsageOwner();
      if (ownerId) await this.reserveCredits(ownerId, options.operation);
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
        await this.safeRecordUsage(
          {
            operation: options.operation,
            model: modelName,
            success: true,
            inputTokens: usageMetadata?.promptTokenCount ?? null,
            outputTokens: usageMetadata?.candidatesTokenCount ?? null,
            errorCode: null,
          },
          ownerId,
        );
        return parsed;
      } catch (error) {
        lastError = error;
        const failure = classifyProviderError(error);
        lastFailure = failure;
        await this.safeRecordUsage(
          {
            operation: options.operation,
            model: modelName,
            success: false,
            inputTokens: usageMetadata?.promptTokenCount ?? null,
            outputTokens: usageMetadata?.candidatesTokenCount ?? null,
            errorCode: classifyError(error),
          },
          ownerId,
        );
        if (failure.kind === 'minute' || failure.kind === 'day') {
          // A quota belongs to the whole model. Falling back would spend the
          // smaller daily budget of the secondary model and hide the real
          // cause from the worker, so fail and let the caller wait or stop.
          this.blockedModels.set(modelName, {
            until: Date.now() + (failure.retryAfterMs ?? DEFAULT_MINUTE_RETRY_MS),
            failure,
          });
          console.warn(
            JSON.stringify({
              level: 'warn',
              operation: 'gemini-quota',
              model: modelName,
              reason: classifyError(error),
              retryAfterMs: failure.retryAfterMs,
            }),
          );
          throw error;
        }
        if (failure.kind === 'model_not_found') {
          this.blockedModels.set(modelName, {
            until: Number.POSITIVE_INFINITY,
            failure,
          });
        } else if (failure.kind !== 'unavailable' && failure.kind !== 'invalid_output') {
          throw error;
        }
        console.warn(
          JSON.stringify({
            level: 'warn',
            operation: 'gemini-fallback',
            model: modelName,
            reason: classifyError(error),
            retryAfterMs: failure.retryAfterMs,
            blockedUntilRestart: failure.kind === 'model_not_found',
          }),
        );
      }
    }

    const failure = lastFailure ?? { kind: 'other' as const };
    throw new ProviderUnavailableError(
      `Gemini quota or availability exhausted for all configured models: ${this.models.join(', ')}`,
      failure,
      { cause: lastError },
    );
  }

  private paceExtraction(prompt: string): Promise<void> {
    const run = this.extractionPaceChain.then(() =>
      this.paceExtractionOnce(prompt),
    );
    this.extractionPaceChain = run.catch(() => undefined);
    return run;
  }

  private async paceExtractionOnce(prompt: string): Promise<void> {
    const estimatedTokens =
      Math.ceil(prompt.length / 3) + EXTRACTION_OUTPUT_TOKEN_RESERVE;
    await this.waitForTokenBudget(estimatedTokens);

    const now = Date.now();
    const startAt = Math.max(now, this.nextExtractionRequestAt);
    this.nextExtractionRequestAt = startAt + this.extractionIntervalMs;
    if (startAt > now) await sleep(startAt - now);

    this.extractionTokenWindow.push({
      at: Date.now(),
      tokens: estimatedTokens,
    });
  }

  private async waitForTokenBudget(estimatedTokens: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (
        this.extractionTokenWindow[0] &&
        this.extractionTokenWindow[0].at <= now - TOKEN_WINDOW_MS
      ) {
        this.extractionTokenWindow.shift();
      }
      const used = this.extractionTokenWindow.reduce(
        (total, entry) => total + entry.tokens,
        0,
      );
      if (used + estimatedTokens <= PROVIDER_TPM_BUDGET) return;
      const oldest = this.extractionTokenWindow[0];
      const waitMs = oldest
        ? Math.max(1_000, oldest.at + TOKEN_WINDOW_MS - now)
        : 1_000;
      await sleep(waitMs);
    }
  }

  private async safeRecordUsage(
    event: AiUsageEvent,
    ownerId: string | undefined,
  ): Promise<void> {
    if (!ownerId) return;
    try {
      await this.recordUsage(event, ownerId);
    } catch {
      console.warn(
        JSON.stringify({
          level: 'warn',
          operation: 'ai-usage-recording',
          reason: 'AI_USAGE_RECORDING_FAILED',
        }),
      );
    }
  }
}

const classifyError = (error: unknown): string => {
  const failure = classifyProviderError(error);
  switch (failure.kind) {
    case 'minute':
      return 'RATE_LIMITED';
    case 'day':
      return 'QUOTA_EXHAUSTED';
    case 'model_not_found':
      return 'MODEL_NOT_FOUND';
    case 'unavailable':
      return 'MODEL_UNAVAILABLE';
    case 'invalid_output':
      return 'INVALID_STRUCTURED_OUTPUT';
    default:
      return 'PROVIDER_ERROR';
  }
};
