import { describe, expect, test } from 'bun:test';
import { StudySessionAggregate, InvalidStudySessionError } from './study-session';
import type { Evaluation, StudySession } from './assessment';

const passed: Evaluation = { status: 'PASSED', missingPremises: [], logicalBreak: null, feedback: 'Correto.' };
const incomplete: Evaluation = { status: 'INCOMPLETE', missingPremises: ['causa'], logicalBreak: null, feedback: 'Explique a causa.' };
const initial = (): StudySession => ({
  id: 'session-1', conceptId: 'concept-1', version: 1, state: 'QUESTION_READY',
  question: { text: 'Por quê?', targetPremise: 'A regra', expectedReasoningSteps: ['Causa'] },
  edgeCaseStatus: 'NOT_REQUESTED', edgeCaseChallenge: null, attempts: [],
  createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
});
const challenge = { scenario: 'Limite', edgeCaseTested: 'Premissa', question: 'E no limite?' };
const at = '2026-10-15T01:00:00.000Z';

describe('StudySessionAggregate', () => {
  test('approval completes the explanation without creating an edge case', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    session.recordInitialAnswer('Minha explicação', passed, at);
    expect(session.snapshot()).toMatchObject({ state: 'EXPLANATION_PASSED', edgeCaseStatus: 'NOT_REQUESTED', attempts: [{ stage: 'INITIAL' }] });
  });

  test('incomplete answer allows another attempt and later approval', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    session.recordInitialAnswer('Tentativa um', incomplete, at);
    expect(session.snapshot().state).toBe('RETRY_INITIAL');
    session.recordInitialAnswer('Tentativa dois', passed, at);
    expect(session.snapshot()).toMatchObject({ state: 'EXPLANATION_PASSED', attempts: [{ stage: 'INITIAL' }, { stage: 'INITIAL' }] });
  });

  test('repeated answer is idempotent and a new answer after approval is rejected', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    session.recordInitialAnswer('Mesma resposta', passed, at);
    session.recordInitialAnswer('Mesma resposta', passed, at);
    expect(session.snapshot().attempts).toHaveLength(1);
    expect(() => session.recordInitialAnswer('Outra resposta', passed, at)).toThrow(InvalidStudySessionError);
  });

  test('edge case requires approval and preserves approval when failed', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    expect(() => session.requestEdgeCase(challenge, at)).toThrow(InvalidStudySessionError);
    session.recordInitialAnswer('Explicação', passed, at);
    session.requestEdgeCase(challenge, at);
    session.requestEdgeCase(challenge, at);
    session.recordEdgeCaseAnswer('Resposta no limite', incomplete, at);
    expect(session.snapshot()).toMatchObject({ state: 'EXPLANATION_PASSED', edgeCaseStatus: 'REVIEW', attempts: [{ stage: 'INITIAL' }, { stage: 'EDGE_CASE_REPLY' }] });
  });

  test('rehydration rejects impossible snapshots', () => {
    expect(() => StudySessionAggregate.rehydrate({ ...initial(), edgeCaseStatus: 'PASSED' })).toThrow(InvalidStudySessionError);
    expect(() => StudySessionAggregate.rehydrate({ ...initial(), edgeCaseChallenge: challenge })).toThrow(InvalidStudySessionError);
    expect(() => StudySessionAggregate.rehydrate({ ...initial(), state: 'EXPLANATION_PASSED' })).toThrow(InvalidStudySessionError);
    expect(() => StudySessionAggregate.rehydrate({ ...initial(), state: 'RETRY_INITIAL' })).toThrow(InvalidStudySessionError);
    expect(() => StudySessionAggregate.rehydrate({ ...initial(), attempts: [
      { stage: 'INITIAL', answer: 'forjada', evaluation: passed, createdAt: at },
    ] })).toThrow(InvalidStudySessionError);
    const approved = StudySessionAggregate.rehydrate(initial());
    approved.recordInitialAnswer('Explicação', passed, at);
    expect(() => StudySessionAggregate.rehydrate({
      ...approved.snapshot(), edgeCaseStatus: 'PASSED', edgeCaseChallenge: challenge,
    })).toThrow(InvalidStudySessionError);
    expect(() => StudySessionAggregate.rehydrate({
      ...approved.snapshot(), edgeCaseStatus: 'REVIEW', edgeCaseChallenge: challenge,
    })).toThrow(InvalidStudySessionError);
    const completed = StudySessionAggregate.rehydrate(approved.snapshot());
    completed.requestEdgeCase(challenge, at);
    completed.recordEdgeCaseAnswer('Resposta aprovada', passed, at);
    expect(() => StudySessionAggregate.rehydrate({
      ...completed.snapshot(), edgeCaseStatus: 'READY',
    })).toThrow(InvalidStudySessionError);
  });

  test('snapshot does not expose mutable aggregate references', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    const snapshot = session.snapshot();
    snapshot.attempts.push({ stage: 'INITIAL', answer: 'forjada', evaluation: passed, createdAt: at });
    snapshot.question.expectedReasoningSteps.push('forjado');
    expect(session.snapshot().attempts).toHaveLength(0);
    expect(session.snapshot().question.expectedReasoningSteps).toEqual(['Causa']);
  });

  test('accepts a legacy stress answer converted to an edge case', () => {
    const session = StudySessionAggregate.rehydrate(initial());
    session.recordInitialAnswer('Explicação aprovada', passed, at);
    const legacy: StudySession = {
      ...session.snapshot(),
      edgeCaseStatus: 'PASSED',
      edgeCaseChallenge: challenge,
      attempts: [...session.snapshot().attempts, {
        stage: 'STRESS_REPLY', answer: 'Resposta legada', evaluation: passed, createdAt: at,
      }],
    };
    expect(StudySessionAggregate.rehydrate(legacy).snapshot()).toEqual(legacy);
  });
});
