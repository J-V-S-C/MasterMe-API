import { describe, expect, test } from 'bun:test';
import { MAX_MATERIAL_LENGTH } from '../application/material-limits';
import { MaterialSchema } from './masterme.schema';
import {
  ConfidenceBodySchema,
  CreateMaterialBodySchema,
  CreatePracticeProjectBodySchema,
  UploadMaterialBodySchema,
} from './http.schema';

const id = '11111111-1111-4111-8111-111111111111';

describe('practice HTTP schemas', () => {
  test.each([1, 2, 3, 4, 5])('accepts confidence %i', (value) =>
    expect(ConfidenceBodySchema.parse({ value }).value).toBe(value),
  );
  test.each([0, 6, 2.5])('rejects invalid confidence %i', (value) =>
    expect(ConfidenceBodySchema.safeParse({ value }).success).toBeFalse(),
  );
  test('overview rejects selections', () =>
    expect(
      CreatePracticeProjectBodySchema.safeParse({
        focusMode: 'OVERVIEW',
        conceptIds: [id],
      }).success,
    ).toBeFalse());
  test('manual requires a selection', () =>
    expect(
      CreatePracticeProjectBodySchema.safeParse({ focusMode: 'MANUAL' })
        .success,
    ).toBeFalse());
  test('rejects duplicate IDs', () =>
    expect(
      CreatePracticeProjectBodySchema.safeParse({
        focusMode: 'MANUAL',
        conceptIds: [id, id],
      }).success,
    ).toBeFalse());
});

describe('material limits', () => {
  const longContent = 'a'.repeat(MAX_MATERIAL_LENGTH + 1);

  test('rejects typed text above the API limit', () =>
    expect(
      CreateMaterialBodySchema.safeParse({
        title: 'Material',
        content: longContent,
      }).success,
    ).toBeFalse());

  test('accepts larger persisted content from uploads', () =>
    expect(
      MaterialSchema.safeParse({
        id,
        title: 'Material',
        content: longContent,
        createdAt: new Date().toISOString(),
      }).success,
    ).toBeTrue());
});

describe('upload locale', () => {
  test('defaults to pt-BR and explicitly accepts en-US', () => {
    expect(UploadMaterialBodySchema.parse({}).locale).toBe('pt-BR');
    expect(UploadMaterialBodySchema.parse({ locale: 'en-US' }).locale).toBe(
      'en-US',
    );
  });
});
