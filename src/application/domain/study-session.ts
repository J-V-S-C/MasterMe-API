import type { AnswerAssistance, EdgeCaseChallenge, Evaluation, StudySession } from './assessment';

export class InvalidStudySessionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidStudySessionError';
  }
}

/** Aggregate root for the study session. All state changes pass through its methods. */
export class StudySessionAggregate {
  private constructor(private readonly data: StudySession) {
    this.assertInvariants();
  }

  public static start(input: {
    id: string;
    conceptId: string;
    question: StudySession['question'];
    at: string;
  }): StudySessionAggregate {
    return new StudySessionAggregate({
      id: input.id,
      conceptId: input.conceptId,
      version: 1,
      state: 'QUESTION_READY',
      question: structuredClone(input.question),
      edgeCaseStatus: 'NOT_REQUESTED',
      edgeCaseChallenge: null,
      attempts: [],
      createdAt: input.at,
      updatedAt: input.at,
    });
  }

  public static rehydrate(snapshot: StudySession): StudySessionAggregate {
    return new StudySessionAggregate(structuredClone(snapshot));
  }

  public snapshot(): StudySession {
    return structuredClone(this.data);
  }

  public hasInitialAnswer(answer: string): boolean {
    return this.data.attempts.some((attempt) => attempt.stage === 'INITIAL' && attempt.answer === answer);
  }

  public hasEdgeCaseAnswer(answer: string): boolean {
    return this.data.attempts.some((attempt) =>
      (attempt.stage === 'EDGE_CASE_REPLY' || attempt.stage === 'STRESS_REPLY') && attempt.answer === answer);
  }

  public assertCanAnswerInitially(): void {
    if (this.data.state !== 'QUESTION_READY' && this.data.state !== 'RETRY_INITIAL') {
      throw new InvalidStudySessionError('A sessão não aceita uma resposta inicial neste momento.');
    }
  }

  public recordInitialAnswer(answer: string, evaluation: Evaluation, at: string, assistance?: AnswerAssistance): void {
    if (this.hasInitialAnswer(answer)) return;
    this.assertCanAnswerInitially();
    this.data.attempts.push({
      stage: 'INITIAL',
      answer,
      evaluation: structuredClone(evaluation),
      ...(assistance ? {
        assisted: assistance.assisted,
        assistanceLevel: assistance.assistanceLevel,
        hintsUsed: [...assistance.hintsUsed],
        solutionRevealed: assistance.solutionRevealed,
      } : {}),
      createdAt: at,
    });
    this.data.state = evaluation.status === 'PASSED' ? 'EXPLANATION_PASSED' : 'RETRY_INITIAL';
    this.data.updatedAt = at;
    this.assertInvariants();
  }

  public assertCanRequestEdgeCase(): void {
    if (this.data.state !== 'EXPLANATION_PASSED') {
      throw new InvalidStudySessionError('O caso-limite só pode ser solicitado após uma explicação aprovada.');
    }
  }

  public hasEdgeCase(): boolean {
    return this.data.edgeCaseChallenge !== null;
  }

  public requestEdgeCase(challenge: EdgeCaseChallenge, at: string): void {
    this.assertCanRequestEdgeCase();
    if (this.hasEdgeCase()) return;
    this.data.edgeCaseChallenge = structuredClone(challenge);
    this.data.edgeCaseStatus = 'READY';
    this.data.updatedAt = at;
    this.assertInvariants();
  }

  public assertCanAnswerEdgeCase(): EdgeCaseChallenge {
    if (this.data.state !== 'EXPLANATION_PASSED' || !this.data.edgeCaseChallenge ||
      (this.data.edgeCaseStatus !== 'READY' && this.data.edgeCaseStatus !== 'REVIEW')) {
      throw new InvalidStudySessionError('A sessão não aceita uma resposta de caso-limite neste momento.');
    }
    return structuredClone(this.data.edgeCaseChallenge);
  }

  public recordEdgeCaseAnswer(answer: string, evaluation: Evaluation, at: string, assistance?: AnswerAssistance): void {
    if (this.hasEdgeCaseAnswer(answer)) return;
    this.assertCanAnswerEdgeCase();
    this.data.edgeCaseStatus = evaluation.status === 'PASSED' ? 'PASSED' : 'REVIEW';
    this.data.attempts.push({
      stage: 'EDGE_CASE_REPLY',
      answer,
      evaluation: structuredClone(evaluation),
      ...(assistance ? {
        assisted: assistance.assisted,
        assistanceLevel: assistance.assistanceLevel,
        hintsUsed: [...assistance.hintsUsed],
        solutionRevealed: assistance.solutionRevealed,
      } : {}),
      createdAt: at,
    });
    this.data.updatedAt = at;
    this.assertInvariants();
  }

  private assertInvariants(): void {
    const { state, edgeCaseChallenge, edgeCaseStatus } = this.data;
    if (this.data.version < 1 || !Number.isInteger(this.data.version)) {
      throw new InvalidStudySessionError('Versão de sessão inválida.');
    }
    if ((edgeCaseStatus === 'NOT_REQUESTED') !== (edgeCaseChallenge === null)) {
      throw new InvalidStudySessionError('O estado do caso-limite não corresponde ao desafio.');
    }
    if (state !== 'EXPLANATION_PASSED' && edgeCaseChallenge !== null) {
      throw new InvalidStudySessionError('Caso-limite exige explicação aprovada.');
    }
    const initialAttempts = this.data.attempts.filter((attempt) => attempt.stage === 'INITIAL');
    const lastInitial = initialAttempts.at(-1);
    const passedInitial = lastInitial?.evaluation.status === 'PASSED';
    if (state === 'QUESTION_READY' && initialAttempts.length > 0) {
      throw new InvalidStudySessionError('Sessão ainda sem resposta não pode ter tentativas iniciais.');
    }
    if (state === 'RETRY_INITIAL' && (!lastInitial || passedInitial)) {
      throw new InvalidStudySessionError('Nova tentativa exige uma avaliação inicial não aprovada.');
    }
    if (state === 'EXPLANATION_PASSED' && !passedInitial) {
      throw new InvalidStudySessionError('Explicação aprovada exige tentativa inicial aprovada.');
    }
    const edgeAttempts = this.data.attempts.filter((attempt) =>
      attempt.stage === 'EDGE_CASE_REPLY' || attempt.stage === 'STRESS_REPLY');
    const lastEdge = edgeAttempts.at(-1);
    if (edgeCaseStatus === 'NOT_REQUESTED' && edgeAttempts.length > 0) {
      throw new InvalidStudySessionError('Resposta de caso-limite exige desafio solicitado.');
    }
    if (edgeCaseStatus === 'READY' && edgeAttempts.length > 0) {
      throw new InvalidStudySessionError('Caso-limite pronto ainda não pode ter respostas.');
    }
    if (edgeCaseStatus === 'REVIEW' && (!lastEdge || lastEdge.evaluation.status === 'PASSED')) {
      throw new InvalidStudySessionError('Revisão de caso-limite exige última resposta não aprovada.');
    }
    if (edgeCaseStatus === 'PASSED' && lastEdge?.evaluation.status !== 'PASSED') {
      throw new InvalidStudySessionError('Caso-limite aprovado exige resposta aprovada.');
    }
  }
}
