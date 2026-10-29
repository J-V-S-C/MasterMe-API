import type { EvidenceActivity } from './learning-cycle';
import type { SupportedLocale } from './material';

const rubrics: Record<SupportedLocale, Record<EvidenceActivity, string>> = {
  'pt-BR': {
    COMPREHENSION: 'Explique o mecanismo ou as condições essenciais do conceito com base no trecho.',
    REASONING: 'Separe o que o trecho afirma do que ele não sustenta; explique como as premissas citadas apoiam a conclusão.',
    RELATION: 'Reconstrua a proposição entre os conceitos e justifique o tipo de relação mostrado no trecho; contraste e parte-todo não exigem causalidade.',
    APPLICATION: 'Descreva um caso concreto e mostre como as premissas do trecho orientam a decisão ou resultado nesse caso.',
    RETENTION: 'Retome as premissas essenciais do conceito em suas palavras; ajuda declarada fica registrada separadamente.',
  },
  'en-US': {
    COMPREHENSION: 'Explain the concept mechanism or essential conditions using the excerpt.',
    REASONING: 'Separate what the excerpt states from what it does not establish; explain how the cited premises support the conclusion.',
    RELATION: 'Reconstruct the proposition between the concepts and justify the relationship shown by the excerpt; contrast and part-whole do not require causation.',
    APPLICATION: 'Describe a concrete case and show how the excerpt premises guide the decision or outcome in that case.',
    RETENTION: 'Recall the essential premises of the concept in your own words; declared assistance is recorded separately.',
  },
};

export const criteriaForActivity = (activityType: EvidenceActivity, locale: SupportedLocale, sourceCriteria: string[]): string[] => [
  rubrics[locale][activityType],
  ...sourceCriteria,
];
