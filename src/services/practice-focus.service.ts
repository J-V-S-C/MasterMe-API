import type {
  Concept,
  ConceptConfidence,
  ConceptPerformance,
  PracticeFocusMode,
  PrioritizedConcept,
} from '../domain/masterme';
import { UnprocessableEntityError } from './errors';

export type PracticeFocus = {
  concepts: Concept[];
  priorities: PrioritizedConcept[];
  signalSnapshot: unknown;
};

export class PracticeFocusService {
  public select(
    mode: PracticeFocusMode,
    concepts: Concept[],
    conceptIds: string[] | undefined,
    confidences: ConceptConfidence[],
    performance: ConceptPerformance[],
  ): PracticeFocus {
    if (mode === 'OVERVIEW' && conceptIds !== undefined) throw new UnprocessableEntityError('OVERVIEW não aceita seleção de conceitos.');
    if (mode === 'MANUAL' && (!conceptIds || conceptIds.length < 1 || conceptIds.length > 5)) throw new UnprocessableEntityError('MANUAL exige de 1 a 5 conceitos.');
    if (conceptIds && new Set(conceptIds).size !== conceptIds.length) throw new UnprocessableEntityError('A seleção não pode conter conceitos repetidos.');
    const scoped = this.scope(concepts, conceptIds);
    const byConfidence = new Map(confidences.map((item) => [item.conceptId, item]));
    const byPerformance = new Map(performance.map((item) => [item.conceptId, item]));

    if (mode === 'OVERVIEW' || mode === 'MANUAL') {
      const selected = [...scoped].sort(this.byName);
      return this.result(selected, () => mode === 'OVERVIEW' ? 'visão geral do material' : 'selecionado manualmente', {});
    }
    if (mode === 'CONFIDENCE') {
      const ranked = scoped.flatMap((concept) => {
        const confidence = byConfidence.get(concept.id);
        return confidence ? [{ concept, confidence }] : [];
      }).sort((left, right) => left.confidence.value - right.confidence.value || this.byName(left.concept, right.concept));
      if (!ranked.length) throw new UnprocessableEntityError('Informe a confiança de ao menos um conceito neste escopo.');
      const selected = ranked.slice(0, 5);
      return this.result(selected.map(({ concept }) => concept), (concept) => `confiança ${byConfidence.get(concept.id)?.value}/5`, selected.map(({ concept, confidence }) => [concept.id, confidence.value]));
    }
    if (mode === 'PERFORMANCE') {
      const ranked = scoped.flatMap((concept) => {
        const item = byPerformance.get(concept.id);
        return item?.weakness === null || !item ? [] : [{ concept, item }];
      }).sort((left, right) => (right.item.weakness ?? 0) - (left.item.weakness ?? 0) || right.item.failedInitialAttempts - left.item.failedInitialAttempts || this.byName(left.concept, right.concept));
      if (!ranked.length) throw new UnprocessableEntityError('Responda ao menos uma pergunta inicial neste escopo para usar desempenho.');
      const selected = ranked.slice(0, 5);
      return this.result(selected.map(({ concept }) => concept), (concept) => {
        const item = byPerformance.get(concept.id);
        return `${item?.failedInitialAttempts ?? 0} de ${item?.totalInitialAttempts ?? 0} tentativas iniciais não aprovadas`;
      }, selected.map(({ concept, item }) => [concept.id, item.weakness, item.failedInitialAttempts]));
    }

    const ranked = scoped.flatMap((concept) => {
      const confidence = byConfidence.get(concept.id);
      const item = byPerformance.get(concept.id);
      const scores = [confidence ? (5 - confidence.value) / 4 : null, item?.weakness ?? null].filter((score): score is number => score !== null);
      return scores.length ? [{ concept, score: scores.reduce((sum, value) => sum + value, 0) / scores.length, confidence, item }] : [];
    }).sort((left, right) => right.score - left.score || this.byName(left.concept, right.concept));
    if (!ranked.length) throw new UnprocessableEntityError('Informe confiança ou responda uma pergunta inicial neste escopo.');
    const selected = ranked.slice(0, 5);
    return this.result(selected.map(({ concept }) => concept), (concept) => {
      const confidence = byConfidence.get(concept.id);
      const item = byPerformance.get(concept.id);
      if (confidence && item?.weakness !== null && item) return `confiança ${confidence.value}/5 combinada com desempenho`;
      return confidence ? `confiança ${confidence.value}/5` : 'desempenho nas tentativas iniciais';
    }, selected.map(({ concept, score, confidence, item }) => [concept.id, score, confidence?.value ?? null, item?.weakness ?? null]));
  }

  private scope(concepts: Concept[], conceptIds?: string[]): Concept[] {
    if (!conceptIds) return concepts;
    const ids = new Set(conceptIds);
    const selected = concepts.filter((concept) => ids.has(concept.id));
    if (selected.length !== ids.size) throw new UnprocessableEntityError('Todos os conceptIds devem pertencer ao material informado.');
    return selected;
  }

  private result(concepts: Concept[], reason: (concept: Concept) => string, signalSnapshot: unknown): PracticeFocus {
    return { concepts, priorities: concepts.map((concept) => ({ conceptId: concept.id, name: concept.name, reason: reason(concept) })), signalSnapshot };
  }

  private readonly byName = (left: Concept, right: Concept): number => left.name.localeCompare(right.name, 'pt-BR');
}
