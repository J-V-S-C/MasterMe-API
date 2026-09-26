import { describe, expect, test } from 'bun:test';
import { ConfidenceBodySchema, CreatePracticeProjectBodySchema } from './http.schema';

const id = '11111111-1111-4111-8111-111111111111';

describe('schemas HTTP da prática', () => {
  test.each([1, 2, 3, 4, 5])('aceita confiança %i', (value) => expect(ConfidenceBodySchema.parse({ value }).value).toBe(value));
  test.each([0, 6, 2.5])('rejeita confiança inválida %i', (value) => expect(ConfidenceBodySchema.safeParse({ value }).success).toBeFalse());
  test('overview rejeita seleção', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'OVERVIEW', conceptIds: [id] }).success).toBeFalse());
  test('manual exige seleção', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'MANUAL' }).success).toBeFalse());
  test('rejeita IDs duplicados', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'MANUAL', conceptIds: [id, id] }).success).toBeFalse());
});
