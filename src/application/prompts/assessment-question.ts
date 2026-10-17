// A cheap screen for generated prompts, not a pedagogical quality guarantee.
const recallOnlyQuestion = /^(o que (é|significa|retorna)|qual (é|o retorno)|defina|what (is|does .* return)|define)(?=\s|[?.,!:;]|$)/i

export const passesAssessmentQuestionScreen = (question: string, requiredIdeas: string[] = []): boolean =>
  question.trim().length >= 30 &&
  !recallOnlyQuestion.test(question.trim()) &&
  (requiredIdeas.length === 0 || requiredIdeas.length >= 2)
