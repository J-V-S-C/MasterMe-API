import { describe, expect, test } from 'bun:test';
import { passesAssessmentQuestionScreen } from './assessment-question';

describe('assessment question screening', () => {
  test.each([
    'O que é uma função na linguagem de programação?',
    'Qual é o retorno desta função quando recebe zero?',
    'What does binary search return if the target is absent?',
    'What concept does the introduction define regarding query execution?',
  ])('rejects recall-only question: %s', (question) => {
    expect(passesAssessmentQuestionScreen(question)).toBeFalse();
  });

  test('accepts a causal question with two required ideas', () => {
    expect(passesAssessmentQuestionScreen(
      'Como a ordenação permite eliminar metade dos elementos após comparar o alvo com o meio?',
      ['Comparar alvo e meio.', 'Descartar a metade impossível pela ordenação.'],
    )).toBeTrue();
  });

  test('does not treat a causal question as recall solely because it contains the word define', () => {
    expect(passesAssessmentQuestionScreen(
      'Como definir uma regra de atualização que preserve a consistência entre estes conceitos?',
    )).toBeTrue();
  });
});
