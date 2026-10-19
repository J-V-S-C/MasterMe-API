// A cheap screen for generated prompts, not a pedagogical quality guarantee.
const recallOnlyQuestion = /^(o que (é|significa|retorna)|qual (é|o retorno)|defina|que conceito .* (define|descreve)|what (is|does .* return|concept .* define)|which concept .* (define|describe)|define)(?=\s|[?.,!:;]|$)/i

export const passesAssessmentQuestionScreen = (question: string, requiredIdeas: string[] = []): boolean =>
  question.trim().length >= 30 &&
  !recallOnlyQuestion.test(question.trim()) &&
  (requiredIdeas.length === 0 || requiredIdeas.length >= 2)
