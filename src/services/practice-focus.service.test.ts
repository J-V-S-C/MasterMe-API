import { describe, expect, test } from 'bun:test';
import type { Concept, ConceptConfidence, ConceptPerformance } from '../domain/masterme';
import { PracticeFocusService } from './practice-focus.service';

const concept = (id: string, name: string): Concept => ({ id, materialId: '00000000-0000-4000-8000-000000000000', name, description: name, kind: 'NODE', sourceExcerpt: name, fundamentalPremises: ['p'], edgeCases: ['e'], studyQuestion: { text: 'q', targetPremise: 'p', expectedReasoningSteps: ['r'] }, generatedLocale: 'pt-BR', prerequisiteIds: [], nextIds: [] });
const concepts = [concept('11111111-1111-4111-8111-111111111111', 'Beta'), concept('22222222-2222-4222-8222-222222222222', 'Alfa')];
const confidence: ConceptConfidence[] = concepts.map((item, index) => ({ conceptId: item.id, value: index ? 4 : 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
const performance: ConceptPerformance[] = concepts.map((item, index) => ({ conceptId: item.id, passedAttempts: 0, logicalBreaks: 0, incompleteAttempts: index ? 1 : 0, totalInitialAttempts: index ? 1 : 0, failedInitialAttempts: index, weakness: index ? 0.5 : null, latestStatus: index ? 'INCOMPLETE' : null, performanceNeed: index ? 0.6 : null }));

describe('PracticeFocusService', () => {
  test('ordena overview e manual por nome', () => expect(new PracticeFocusService().select('OVERVIEW', concepts, undefined, [], []).priorities.map(({ name }) => name)).toEqual(['Alfa', 'Beta']));
  test('prioriza menor confiança', () => expect(new PracticeFocusService().select('CONFIDENCE', concepts, undefined, confidence, []).priorities[0]?.name).toBe('Beta'));
  test('prioriza maior fraqueza', () => expect(new PracticeFocusService().select('PERFORMANCE', concepts, undefined, [], performance).priorities[0]?.name).toBe('Alfa'));
  test('combina apenas os sinais disponíveis', () => expect(new PracticeFocusService().select('COMBINED', concepts, undefined, confidence, performance).priorities[0]?.name).toBe('Beta'));
  test('não dilui uma dificuldade forte com outro sinal positivo', () => {
    const priorities = new PracticeFocusService().select('COMBINED', concepts, undefined, [{ ...confidence[0]!, value: 5 }], [{ ...performance[0]!, performanceNeed: 1, latestStatus: 'LOGICAL_BREAK' }]).priorities;
    expect(priorities[0]?.name).toBe('Beta');
  });
  test('exclui conceito dominado do foco automático', () => {
    expect(() => new PracticeFocusService().select('COMBINED', concepts, undefined, confidence.map((item) => ({ ...item, value: 5 })), performance.map((item) => ({ ...item, performanceNeed: 0, latestStatus: 'PASSED' })))).toThrow('Nenhuma dificuldade ativa');
  });
  test('limita foco automático aos três maiores sinais', () => {
    const many = ['1', '2', '3', '4'].map((id) => concept(`${id.repeat(8)}-${id.repeat(4)}-4${id.repeat(3)}-8${id.repeat(3)}-${id.repeat(12)}`, `Conceito ${id}`));
    const signals = many.map((item, index): ConceptConfidence => ({ conceptId: item.id, value: index + 1 as 1 | 2 | 3 | 4, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
    expect(new PracticeFocusService().select('CONFIDENCE', many, undefined, signals, []).priorities).toHaveLength(3);
  });
  test('rejeita modo sem dados em vez de usar fallback', () => expect(() => new PracticeFocusService().select('CONFIDENCE', concepts, undefined, [], [])).toThrow('Informe a confiança'));
  test('rejeita conceito fora do material', () => expect(() => new PracticeFocusService().select('MANUAL', concepts, ['33333333-3333-4333-8333-333333333333'], [], [])).toThrow('pertencer ao material'));
});
