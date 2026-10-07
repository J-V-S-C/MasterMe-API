import { describe, expect, test } from 'bun:test';
import type { Concept, ConceptConfidence, ConceptPerformance } from '../domain/masterme';
import { PracticeFocusService } from './practice-focus.service';

const concept = (id: string, name: string): Concept => ({ id, materialId: '00000000-0000-4000-8000-000000000000', name, description: name, kind: 'NODE', sourceExcerpt: name, fundamentalPremises: ['p'], edgeCases: ['e'], studyQuestion: { text: 'q', targetPremise: 'p', expectedReasoningSteps: ['r'] }, generatedLocale: 'pt-BR', prerequisiteIds: [], nextIds: [] });
const concepts = [concept('11111111-1111-4111-8111-111111111111', 'Beta'), concept('22222222-2222-4222-8222-222222222222', 'Alfa')];
const confidence: ConceptConfidence[] = concepts.map((item, index) => ({ conceptId: item.id, value: index ? 4 : 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
const performance: ConceptPerformance[] = concepts.map((item, index) => ({ conceptId: item.id, passedAttempts: index, logicalBreaks: index ? 1 : 0, incompleteAttempts: 0, totalInitialAttempts: index ? 2 : 0, failedInitialAttempts: index, weakness: index ? 0.5 : null, latestStatus: index ? 'PASSED' : null, performanceNeed: index ? 0 : null }));

describe('PracticeFocusService', () => {
  test('ordena overview e manual por nome', () => expect(new PracticeFocusService().select('OVERVIEW', concepts, undefined, [], []).priorities.map(({ name }) => name)).toEqual(['Alfa', 'Beta']));
  test('prioriza menor confiança', () => expect(new PracticeFocusService().select('CONFIDENCE', concepts, undefined, confidence, []).priorities[0]?.name).toBe('Beta'));
  test('prioriza maior fraqueza', () => expect(new PracticeFocusService().select('PERFORMANCE', concepts, undefined, [], performance).priorities[0]?.name).toBe('Alfa'));
  test('combina apenas os sinais disponíveis', () => expect(new PracticeFocusService().select('COMBINED', concepts, undefined, confidence, performance).priorities[0]?.name).toBe('Beta'));
  test('rejeita modo sem dados em vez de usar fallback', () => expect(() => new PracticeFocusService().select('CONFIDENCE', concepts, undefined, [], [])).toThrow('Informe a confiança'));
  test('rejeita conceito fora do material', () => expect(() => new PracticeFocusService().select('MANUAL', concepts, ['33333333-3333-4333-8333-333333333333'], [], [])).toThrow('pertencer ao material'));
});
