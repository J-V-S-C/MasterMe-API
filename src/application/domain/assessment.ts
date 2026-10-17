export type EvaluationStatus = 'PASSED' | 'LOGICAL_BREAK' | 'INCOMPLETE';
export interface MasterMeQuestion {
  text: string;
  targetPremise: string;
  expectedReasoningSteps: string[];
  learningObjective?: string;
  requiredIdeas?: string[];
  commonMisconceptions?: string[];
}
export interface ConceptPerformance {
  conceptId: string;
  passedAttempts: number;
  logicalBreaks: number;
  incompleteAttempts: number;
  totalInitialAttempts: number;
  failedInitialAttempts: number;
  weakness: number | null;
  latestStatus: EvaluationStatus | null;
  performanceNeed: number | null;
}
export interface Evaluation {
  status: EvaluationStatus;
  missingPremises: string[];
  logicalBreak: string | null;
  feedback: string;
  strength?: string;
  gap?: string | null;
  nextAction?: string;
}
export interface EdgeCaseChallenge {
  scenario: string;
  edgeCaseTested: string;
  question: string;
}
export type StressTest = EdgeCaseChallenge;
export type EdgeCaseStatus = 'NOT_REQUESTED' | 'READY' | 'REVIEW' | 'PASSED';
export type SessionState = 'QUESTION_READY' | 'RETRY_INITIAL' | 'EXPLANATION_PASSED';
export interface Attempt {
  stage: 'INITIAL' | 'EDGE_CASE_REPLY' | 'STRESS_REPLY';
  answer: string;
  evaluation: Evaluation;
  createdAt: string;
}
export interface StudySession {
  id: string;
  conceptId: string;
  version: number;
  state: SessionState;
  question: MasterMeQuestion;
  edgeCaseStatus: EdgeCaseStatus;
  edgeCaseChallenge: EdgeCaseChallenge | null;
  attempts: Attempt[];
  createdAt: string;
  updatedAt: string;
}
export interface IsomorphicProblem {
  title: string;
  scenario: string;
  constraints: string[];
  responseInstruction: string;
}
