import { describe, expect, test } from 'bun:test';
import { MaterialSchema, MAX_MATERIAL_LENGTH } from '../domain/masterme';
import { ConfidenceBodySchema, CreateMaterialBodySchema, CreatePracticeProjectBodySchema } from './http.schema';

const id = '11111111-1111-4111-8111-111111111111';

describe('schemas HTTP da prática', () => {
  test.each([1, 2, 3, 4, 5])('aceita confiança %i', (value) => expect(ConfidenceBodySchema.parse({ value }).value).toBe(value));
  test.each([0, 6, 2.5])('rejeita confiança inválida %i', (value) => expect(ConfidenceBodySchema.safeParse({ value }).success).toBeFalse());
  test('overview rejeita seleção', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'OVERVIEW', conceptIds: [id] }).success).toBeFalse());
  test('manual exige seleção', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'MANUAL' }).success).toBeFalse());
  test('rejeita IDs duplicados', () => expect(CreatePracticeProjectBodySchema.safeParse({ focusMode: 'MANUAL', conceptIds: [id, id] }).success).toBeFalse());
});

describe('limites de material', () => {
  const longContent = 'a'.repeat(MAX_MATERIAL_LENGTH + 1);

  test('rejeita texto digitado acima do limite da API', () =>
    expect(CreateMaterialBodySchema.safeParse({ title: 'Material', content: longContent }).success).toBeFalse());

  test('aceita conteúdo persistido maior quando veio de upload', () =>
    expect(MaterialSchema.safeParse({ id, title: 'Material', content: longContent, createdAt: new Date().toISOString() }).success).toBeTrue());
});
