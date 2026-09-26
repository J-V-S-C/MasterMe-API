import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Environment } from './environment';
import { GeminiStructuredClient, type AiUsageEvent } from './llm';

const environment = {
  GEMINI_API_KEY: 'test-key',
  MODEL_NAME: 'gemini-primary',
  GEMINI_MODEL_FALLBACKS: ['gemini-backup'],
  EXTRACTION_CONCURRENCY: 1,
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
      await client.generateStructured(schema, 'prompt', {
        operation: 'INITIAL_EVALUATION',
        maxOutputTokens: 100,
      }),
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
      await client.generateStructured(schema, 'prompt', {
        operation: 'EXTRACTION',
        maxOutputTokens: 100,
      }),
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
      await client.generateStructured(nested, 'prompt', {
        operation: 'EXTRACTION',
        maxOutputTokens: 100,
      }),
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
});
