// A limited shape screen for legacy questions and challenge prompts, not a semantic source check.

const recallOnlyQuestion = /^(o que (é|significa|retorna)|qual (é|o retorno)|defina|que conceito .* (define|descreve)|what (is|does .* return|concept .* define)|which concept .* (define|describe)|define)(?=\s|[?.,!:;]|$)/i

export const passesAssessmentQuestionScreen = (question: string, requiredIdeas: string[] = []): boolean =>
  question.trim().length >= 30 &&
  !recallOnlyQuestion.test(question.trim()) &&
  (requiredIdeas.length === 0 || requiredIdeas.length >= 2)

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
