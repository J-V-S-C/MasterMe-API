const recallOnlyQuestion = /^(o que (é|significa|retorna)|qual (é|o retorno)|defina|what (is|does .* return)|define)\b/i

export const isUsefulAssessmentQuestion = (question: string, requiredIdeas: string[] = []): boolean =>
  question.trim().length >= 30 &&
  !recallOnlyQuestion.test(question.trim()) &&
  (requiredIdeas.length === 0 || requiredIdeas.length >= 2)
