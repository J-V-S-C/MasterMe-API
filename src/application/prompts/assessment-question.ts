// A cheap screen for generated prompts, not a pedagogical quality guarantee.
import type { MasterMeQuestion } from '../domain/assessment';

const recallOnlyQuestion = /^(o que (é|significa|retorna)|qual (é|o retorno)|defina|que conceito .* (define|descreve)|what (is|does .* return|concept .* define)|which concept .* (define|describe)|define)(?=\s|[?.,!:;]|$)/i

export const passesAssessmentQuestionScreen = (question: string, requiredIdeas: string[] = []): boolean =>
  question.trim().length >= 30 &&
  !recallOnlyQuestion.test(question.trim()) &&
  (requiredIdeas.length === 0 || requiredIdeas.length >= 2)

// A conservative warning screen for questions that introduce several concrete
// terms absent from their cited span. It cannot prove semantic support.
const genericTerms = new Set([
  'about', 'allow', 'allows', 'apenas', 'apresenta', 'apply', 'arquitetura', 'architecture', 'based',
  'between', 'como', 'concept', 'conceito', 'could', 'describe', 'descreva', 'detail',
  'detail', 'detalhe', 'different', 'does', 'each', 'explain', 'explique', 'from', 'given', 'how', 'idea',
  'important', 'influence', 'into', 'main', 'mechanism', 'mecanismo', 'more', 'most', 'other',
  'para', 'part', 'parts', 'passage', 'point', 'porque', 'principal', 'proprio', 'question', 'role', 'selected', 'selecionado', 'sobre', 'some', 'style', 'support', 'sustente',
  'such', 'system', 'sistema', 'that', 'their', 'these', 'this', 'through', 'trecho', 'uses',
  'using', 'when', 'where', 'which', 'while', 'with', 'what', 'why', 'would',
]);
const contentTerms = (value: string): string[] => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .match(/[a-z0-9]{4,}/g)?.filter((term) => !genericTerms.has(term)) ?? [];

export const questionIntroducesUnsupportedTerms = (question: string, sourceExcerpt: string): boolean => {
  const citedTerms = new Set(contentTerms(sourceExcerpt));
  const questionTerms = [...new Set(contentTerms(question))];
  if (questionTerms.length < 5) return false;
  const absent = questionTerms.filter((term) => !citedTerms.has(term));
  return absent.length >= 3 && absent.length / questionTerms.length >= 0.35;
};

export const sourceGroundedFallbackQuestion = (name: string, locale: 'pt-BR' | 'en-US'): MasterMeQuestion => locale === 'pt-BR'
  ? {
      text: `Como o trecho selecionado apresenta “${name}”? Explique a ideia principal e cite um detalhe do próprio trecho que a sustente.`,
      targetPremise: 'Explicar a ideia principal usando somente o trecho selecionado.',
      expectedReasoningSteps: ['Identificar a ideia principal do trecho.', 'Apoiar a explicação com um detalhe explícito do trecho.'],
      requiredIdeas: ['Ideia principal do trecho.', 'Um detalhe de apoio presente no trecho.'],
    }
  : {
      text: `How does the selected passage present “${name}”? Explain its main point and use one detail from the passage to support it.`,
      targetPremise: 'Explain the main point using only the selected passage.',
      expectedReasoningSteps: ['Identify the main point of the passage.', 'Support the explanation with one explicit detail from the passage.'],
      requiredIdeas: ['Main point of the passage.', 'A supporting detail stated in the passage.'],
    };

export const focusExcerptOnChapter = (excerpt: string, conceptName: string): { text: string; offsetDelta: number } => {
  const concept = conceptName.normalize('NFD').replace(/[\u0300-\u036f\W_]/g, '').toLowerCase();
  if (concept.length < 8) return { text: excerpt, offsetDelta: 0 };
  const headings = excerpt.matchAll(/(?:^|\n|[.!?]\s+)((?:Chapter|Cap[ií]tulo)\s+\d{1,3}(?:[.:]|\s)\s*[^\n]+)/gim);
  for (const heading of headings) {
    const title = heading[1]!.normalize('NFD').replace(/[\u0300-\u036f\W_]/g, '').toLowerCase();
    if (!title.includes(concept)) continue;
    const offsetDelta = heading.index + heading[0].indexOf(heading[1]!);
    if (offsetDelta > 0) return { text: excerpt.slice(offsetDelta), offsetDelta };
  }
  return { text: excerpt, offsetDelta: 0 };
};
