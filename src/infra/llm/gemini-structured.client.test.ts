import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Environment } from '../../config/environment';
import { GeminiStructuredClient } from './gemini-structured.client';
import type { AiOperation } from '../../application/domain/billing';
import type { AiUsageEvent } from '../../application/ports/llm.gateway';
import { withAiUsageOwner } from '../context/ai-usage-context';
import { AppError } from '../../application/errors';

const environment = {
  GEMINI_API_KEY: 'test-key',
  MODEL_NAME: 'gemini-primary',
  GEMINI_MODEL_FALLBACKS: ['gemini-backup'],
  EXTRACTION_CONCURRENCY: 1,
  AI_DAILY_REQUEST_LIMIT: 2,
} as Environment;
const schema = z.object({ value: z.string().min(1) });

describe('GeminiStructuredClient', () => {
  test('sends JSON Schema to the official SDK, validates with Zod and records tokens', async () => {
    const calls: unknown[] = [];
    const usage: AiUsageEvent[] = [];
    const generator = {
      generateContent: async (request: unknown) => {
        calls.push(request);
        return {
          text: '{"value":"ok"}',
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
        };
      },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(
      environment,
      async (event) => {
        usage.push(event);
      },
      generator,
    );

    expect(
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () =>
        client.generateStructured(schema, 'prompt', {
          operation: 'INITIAL_EVALUATION',
          maxOutputTokens: 100,
        }),
      ),
    ).toEqual({ value: 'ok' });
    expect(calls).toEqual([
      {
        model: 'gemini-primary',
        contents: 'prompt',
        config: {
          temperature: 0.1,
          maxOutputTokens: 100,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
    ]);
    expect(usage).toEqual([
      {
        operation: 'INITIAL_EVALUATION',
        model: 'gemini-primary',
        success: true,
        inputTokens: 12,
        outputTokens: 5,
        errorCode: null,
      },
    ]);
  });

  test('uses the next model when the first returns invalid JSON', async () => {
    const calls: string[] = [];
    const usage: AiUsageEvent[] = [];
    const generator = {
      generateContent: async (request: { model: string }) => {
        calls.push(request.model);
        return {
          text:
            request.model === 'gemini-primary' ? '{invalid' : '{"value":"ok"}',
        };
      },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(
      environment,
      async (event) => {
        usage.push(event);
      },
      generator,
    );

    expect(
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () =>
        client.generateStructured(schema, 'prompt', {
          operation: 'EXTRACTION',
          maxOutputTokens: 100,
        }),
      ),
    ).toEqual({ value: 'ok' });
    expect(calls).toEqual(['gemini-primary', 'gemini-backup']);
    expect(usage.map((event) => [event.success, event.errorCode])).toEqual([
      [false, 'INVALID_STRUCTURED_OUTPUT'],
      [true, null],
    ]);
  });

  test('preserves nested fields in the extraction schema', async () => {
    let sentSchema: unknown;
    const generator = {
      generateContent: async (request: {
        config: { responseJsonSchema: unknown };
      }) => {
        sentSchema = request.config.responseJsonSchema;
        return { text: '{"fragments":[{"name":"A"}]}' };
      },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(
      environment,
      undefined,
      generator,
    );
    const nested = z.object({
      fragments: z.array(z.object({ name: z.string().min(1) })),
    });

    expect(
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () =>
        client.generateStructured(nested, 'prompt', {
          operation: 'EXTRACTION',
          maxOutputTokens: 100,
        }),
      ),
    ).toEqual({ fragments: [{ name: 'A' }] });
    expect(sentSchema).toEqual({
      type: 'object',
      properties: {
        fragments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
      required: ['fragments'],
    });
  });

  test('reserves credits before calling the provider and blocks when unavailable', async () => {
    let providerCalls = 0;
    const generator = {
      generateContent: async () => {
        providerCalls += 1;
        return { text: '{"value":"ok"}' };
      },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(
      environment,
      undefined,
      generator,
      async () => {
        throw new AppError('AI_CREDIT_LIMIT_REACHED',
          'Créditos insuficientes.',
        );
      },
    );

    await expect(
      withAiUsageOwner('11111111-1111-4111-8111-111111111111', () =>
        client.generateStructured(schema, 'prompt', {
          operation: 'INITIAL_EVALUATION',
          maxOutputTokens: 100,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'AI_CREDIT_LIMIT_REACHED',
    });
    expect(providerCalls).toBe(0);
  });

  test('each actual fallback attempt reserves the operation weight again', async () => {
    const reservations: AiOperation[] = [];
    const generator = {
      generateContent: async (request: { model: string }) =>
        request.model === 'gemini-primary'
          ? { text: '{invalid' }
          : { text: '{"value":"ok"}' },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(
      environment,
      undefined,
      generator,
      async (_ownerId, operation) => {
        reservations.push(operation);
      },
    );

    await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () =>
      client.generateStructured(schema, 'prompt', {
        operation: 'EXTRACTION',
        maxOutputTokens: 100,
      }),
    );

    expect(reservations).toEqual(['EXTRACTION', 'EXTRACTION']);
  });
});
