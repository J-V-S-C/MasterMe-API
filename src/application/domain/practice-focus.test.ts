import { describe, expect, test } from 'bun:test';
import type { Concept, ConceptConfidence } from './concept';
import type { ConceptPerformance } from './assessment';
import { PracticeFocusService } from './practice-focus';

const concept = (id: string, name: string): Concept => ({
  id,
  materialId: '00000000-0000-4000-8000-000000000000',
  name,
  description: name,
  kind: 'NODE',
  sourceExcerpt: name,
  fundamentalPremises: ['p'],
  edgeCases: ['e'],
  studyQuestion: {
    text: 'q',
    targetPremise: 'p',
    expectedReasoningSteps: ['r'],
  },
  generatedLocale: 'pt-BR',
  prerequisiteIds: [],
  nextIds: [],
});
const concepts = [
  concept('11111111-1111-4111-8111-111111111111', 'Beta'),
  concept('22222222-2222-4222-8222-222222222222', 'Alfa'),
];
const confidence: ConceptConfidence[] = concepts.map((item, index) => ({
  conceptId: item.id,
  value: index ? 4 : 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));
const performance: ConceptPerformance[] = concepts.map((item, index) => ({
  conceptId: item.id,
  passedAttempts: 0,
  logicalBreaks: 0,
  incompleteAttempts: index ? 1 : 0,
  totalInitialAttempts: index ? 1 : 0,
  failedInitialAttempts: index,
  weakness: index ? 0.5 : null,
  latestStatus: index ? 'INCOMPLETE' : null,
  performanceNeed: index ? 0.6 : null,
}));

describe('PracticeFocusService', () => {
  test('keeps overview manageable and removes repeated concept names', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...concept(String(index), index === 8 ? 'Topic 2' : `Topic ${index}`),
      sourceOffset: index * 100,
    }));
    const priorities = new PracticeFocusService().select('OVERVIEW', many, undefined, [], []).priorities;
    expect(priorities).toHaveLength(5);
    expect(new Set(priorities.map((item) => item.name.toLocaleLowerCase())).size).toBe(5);
  });
  test('sorts overview and manual selections by name', () =>
    expect(
      new PracticeFocusService()
        .select('OVERVIEW', concepts, undefined, [], [])
        .priorities.map(({ name }) => name),
    ).toEqual(['Alfa', 'Beta']));
  test('prioritizes lower confidence', () =>
    expect(
      new PracticeFocusService().select(
        'CONFIDENCE',
        concepts,
        undefined,
        confidence,
        [],
      ).priorities[0]?.name,
    ).toBe('Beta'));
  test('prioritizes greater weakness', () =>
    expect(
      new PracticeFocusService().select(
        'PERFORMANCE',
        concepts,
        undefined,
        [],
        performance,
      ).priorities[0]?.name,
    ).toBe('Alfa'));
  test('combines only available signals', () =>
    expect(
      new PracticeFocusService().select(
        'COMBINED',
        concepts,
        undefined,
        confidence,
        performance,
      ).priorities[0]?.name,
    ).toBe('Beta'));
  test('does not dilute a strong weakness with another positive signal', () => {
    const priorities = new PracticeFocusService().select(
      'COMBINED',
      concepts,
      undefined,
      [{ ...confidence[0]!, value: 5 }],
      [
        {
          ...performance[0]!,
          performanceNeed: 1,
          latestStatus: 'LOGICAL_BREAK',
        },
      ],
    ).priorities;
    expect(priorities[0]?.name).toBe('Beta');
  });
  test('excludes mastered concepts from automatic focus', () => {
    expect(() =>
      new PracticeFocusService().select(
        'COMBINED',
        concepts,
        undefined,
        confidence.map((item) => ({ ...item, value: 5 })),
        performance.map((item) => ({
          ...item,
          performanceNeed: 0,
          latestStatus: 'PASSED',
        })),
      ),
    ).toThrow('Nenhuma dificuldade ativa');
  });
  test('limits automatic focus to the three strongest signals', () => {
    const many = ['1', '2', '3', '4'].map((id) =>
      concept(
        `${id.repeat(8)}-${id.repeat(4)}-4${id.repeat(3)}-8${id.repeat(3)}-${id.repeat(12)}`,
        `Conceito ${id}`,
      ),
    );
    const signals = many.map(
      (item, index): ConceptConfidence => ({
        conceptId: item.id,
        value: (index + 1) as 1 | 2 | 3 | 4,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(
      new PracticeFocusService().select(
        'CONFIDENCE',
        many,
        undefined,
        signals,
        [],
      ).priorities,
    ).toHaveLength(3);
  });
  test('rejects a mode without data instead of using a fallback', () =>
    expect(() =>
      new PracticeFocusService().select(
        'CONFIDENCE',
        concepts,
        undefined,
        [],
        [],
      ),
    ).toThrow('Informe a confiança'));
  test('rejects concepts outside the material', () =>
    expect(() =>
      new PracticeFocusService().select(
        'MANUAL',
        concepts,
        ['33333333-3333-4333-8333-333333333333'],
        [],
        [],
      ),
    ).toThrow('pertencer ao material'));
});
