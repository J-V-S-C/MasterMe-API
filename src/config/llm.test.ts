import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Environment } from './environment';
import { GeminiStructuredClient, type AiOperation, type AiUsageEvent } from './llm';
import { withAiUsageOwner } from '../services/ai-usage-context';
import { AppError } from '../services/errors';

const environment = {
  GEMINI_API_KEY: 'test-key',
  MODEL_NAME: 'gemini-primary',
  GEMINI_MODEL_FALLBACKS: ['gemini-backup'],
  EXTRACTION_CONCURRENCY: 1,
  AI_DAILY_REQUEST_LIMIT: 2,
} as Environment;
const schema = z.object({ value: z.string().min(1) });

describe('GeminiStructuredClient', () => {
  test('envia JSON Schema ao SDK oficial, valida com Zod e registra tokens', async () => {
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
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => client.generateStructured(schema, 'prompt', {
        operation: 'INITIAL_EVALUATION',
        maxOutputTokens: 100,
      })),
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

  test('usa o próximo modelo quando o primeiro retorna JSON inválido', async () => {
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
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => client.generateStructured(schema, 'prompt', {
        operation: 'EXTRACTION',
        maxOutputTokens: 100,
      })),
    ).toEqual({ value: 'ok' });
    expect(calls).toEqual(['gemini-primary', 'gemini-backup']);
    expect(usage.map((event) => [event.success, event.errorCode])).toEqual([
      [false, 'INVALID_STRUCTURED_OUTPUT'],
      [true, null],
    ]);
  });

  test('preserva campos aninhados no schema de extração', async () => {
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
      await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => client.generateStructured(nested, 'prompt', {
        operation: 'EXTRACTION',
        maxOutputTokens: 100,
      })),
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

  test('reserva créditos antes do provedor e bloqueia sem efetuar a chamada', async () => {
    let providerCalls = 0;
    const generator = {
      generateContent: async () => { providerCalls += 1; return { text: '{"value":"ok"}' }; },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2];
    const client = new GeminiStructuredClient(environment, undefined, generator, async () => {
      throw new AppError(429, 'AI_CREDIT_LIMIT_REACHED', 'Créditos insuficientes.')
    });

    await expect(withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => client.generateStructured(schema, 'prompt', {
      operation: 'INITIAL_EVALUATION',
      maxOutputTokens: 100,
    }))).rejects.toMatchObject({ statusCode: 429, code: 'AI_CREDIT_LIMIT_REACHED' });
    expect(providerCalls).toBe(0);
  });

  test('cada tentativa real de fallback reserva novamente o peso da operação', async () => {
    const reservations: AiOperation[] = []
    const generator = {
      generateContent: async (request: { model: string }) => request.model === 'gemini-primary'
        ? { text: '{invalid' }
        : { text: '{"value":"ok"}' },
    } as unknown as ConstructorParameters<typeof GeminiStructuredClient>[2]
    const client = new GeminiStructuredClient(environment, undefined, generator, async (_ownerId, operation) => { reservations.push(operation) })

    await withAiUsageOwner('11111111-1111-4111-8111-111111111111', () => client.generateStructured(schema, 'prompt', {
      operation: 'EXTRACTION',
      maxOutputTokens: 100,
    }))

    expect(reservations).toEqual(['EXTRACTION', 'EXTRACTION'])
  })
});
