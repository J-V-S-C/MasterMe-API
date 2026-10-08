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

const ACTIVE_NEED_THRESHOLD = 0.25;
const AUTOMATIC_FOCUS_LIMIT = 3;

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
        if (!confidence) return [];
        const score = (5 - confidence.value) / 4;
        return score >= ACTIVE_NEED_THRESHOLD ? [{ concept, confidence, score }] : [];
      }).sort((left, right) => right.score - left.score || this.byName(left.concept, right.concept));
      if (!confidences.some(({ conceptId }) => scoped.some(({ id }) => id === conceptId))) throw new UnprocessableEntityError('Informe a confiança de ao menos um conceito neste escopo.');
      if (!ranked.length) throw this.noActiveDifficulty();
      const selected = ranked.slice(0, AUTOMATIC_FOCUS_LIMIT);
      return this.result(selected.map(({ concept }) => concept), (concept) => this.confidenceReason(concept, byConfidence.get(concept.id)?.value), selected.map(({ concept, confidence, score }) => [concept.id, confidence.value, score]));
    }
    if (mode === 'PERFORMANCE') {
      const ranked = scoped.flatMap((concept) => {
        const item = byPerformance.get(concept.id);
        if (!item || item.performanceNeed === null) return [];
        return item.performanceNeed >= ACTIVE_NEED_THRESHOLD ? [{ concept, item, score: item.performanceNeed }] : [];
      }).sort((left, right) => right.score - left.score || this.byName(left.concept, right.concept));
      if (!performance.some(({ conceptId, performanceNeed }) => performanceNeed !== null && scoped.some(({ id }) => id === conceptId))) throw new UnprocessableEntityError('Responda ao menos uma pergunta inicial neste escopo para usar desempenho.');
      if (!ranked.length) throw this.noActiveDifficulty();
      const selected = ranked.slice(0, AUTOMATIC_FOCUS_LIMIT);
      return this.result(selected.map(({ concept }) => concept), (concept) => this.performanceReason(concept, byPerformance.get(concept.id)), selected.map(({ concept, item, score }) => [concept.id, score, item.latestStatus]));
    }

    const ranked = scoped.flatMap((concept) => {
      const confidence = byConfidence.get(concept.id);
      const item = byPerformance.get(concept.id);
      const scores = [confidence ? (5 - confidence.value) / 4 : null, item?.performanceNeed ?? null].filter((score): score is number => score !== null);
      const score = scores.length ? Math.max(...scores) : null;
      return score !== null && score >= ACTIVE_NEED_THRESHOLD ? [{ concept, score, confidence, item }] : [];
    }).sort((left, right) => right.score - left.score || this.byName(left.concept, right.concept));
    const hasSignals = scoped.some((concept) => byConfidence.has(concept.id) || byPerformance.get(concept.id)?.performanceNeed !== null);
    if (!hasSignals) throw new UnprocessableEntityError('Informe confiança ou responda uma pergunta inicial neste escopo.');
    if (!ranked.length) throw this.noActiveDifficulty();
    const selected = ranked.slice(0, AUTOMATIC_FOCUS_LIMIT);
    return this.result(selected.map(({ concept }) => concept), (concept) => {
      const confidence = byConfidence.get(concept.id);
      const item = byPerformance.get(concept.id);
      if (confidence && item?.performanceNeed !== null && item) return concept.generatedLocale === 'en-US' ? `confidence ${confidence.value}/5 combined with latest performance` : `confiança ${confidence.value}/5 combinada ao desempenho mais recente`;
      return confidence ? this.confidenceReason(concept, confidence.value) : this.performanceReason(concept, item);
    }, selected.map(({ concept, score, confidence, item }) => [concept.id, score, confidence?.value ?? null, item?.performanceNeed ?? null, item?.latestStatus ?? null]));
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

  private confidenceReason(concept: Concept, value: number | undefined): string {
    return concept.generatedLocale === 'en-US' ? `self-reported confidence ${value}/5` : `confiança informada ${value}/5`;
  }

  private performanceReason(concept: Concept, item: ConceptPerformance | undefined): string {
    const status = item?.latestStatus ?? 'INCOMPLETE';
    return concept.generatedLocale === 'en-US' ? `latest initial answer: ${status}` : `resposta inicial mais recente: ${status}`;
  }

  private noActiveDifficulty(): UnprocessableEntityError {
    return new UnprocessableEntityError('Nenhuma dificuldade ativa foi encontrada. Use seleção manual ou visão geral se ainda quiser gerar um projeto.');
  }

  private readonly byName = (left: Concept, right: Concept): number => left.name.localeCompare(right.name, 'pt-BR');
}
