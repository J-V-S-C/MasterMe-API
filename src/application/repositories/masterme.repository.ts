import type { Concept, ConceptConfidence, ConceptRelation } from '../domain/concept';
import type { AnswerAssistance, Evaluation, IsomorphicProblem, StudySession } from '../domain/assessment';
import type { EvidenceActivity, EvidenceStatus } from '../domain/learning-cycle';
import type { MaterialKind, MaterialOutlineUnit, MaterialSummary, StudyMaterial, SupportedLocale } from '../domain/material';
import type { PracticeProject } from '../domain/practice-project';
import type { AiUsageEvent } from '../ports/llm.gateway';
import type { QuestionBundle } from '../domain/assessment';

export type AiUsageSummary = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  dailyLimit: number;
  remainingRequests: number;
  resetsAt: string;
  byModel: Array<{
    model: string;
    requests: number;
    successes: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byOperation: Array<{
    operation: string;
    requests: number;
    successes: number;
    inputTokens: number;
    outputTokens: number;
  }>;
};

type Awaitable<T> = T | Promise<T>;

export interface MasterMeRepository {
  saveMaterial(material: StudyMaterial, ownerId: string): Awaitable<void>;
  findMaterial(id: string): Awaitable<StudyMaterial | undefined>;
  findMaterialOutline(id: string): Awaitable<MaterialOutlineUnit[]>;
  findAllMaterials(ownerId: string): Promise<MaterialSummary[]>;
  updateMaterialKind(id: string, ownerId: string, kind: MaterialKind): Awaitable<StudyMaterial | undefined>;
  saveConcepts(
    concepts: Concept[],
    relations?: ConceptRelation[],
    processingJobId?: string,
    unitId?: string,
  ): Awaitable<void>;
  saveConceptLocalizations(
    materialId: string,
    locale: SupportedLocale,
    concepts: Concept[],
  ): Awaitable<void>;
  findConcept(id: string): Awaitable<Concept | undefined>;
  conceptBelongsToOwner(conceptId: string, ownerId: string): Awaitable<boolean>;
  findConceptsByMaterial(materialId: string): Awaitable<Concept[]>;
  findAllConceptsByMaterial(materialId: string): Awaitable<Concept[]>;
  findRecentLearningGaps(conceptIds: string[]): Awaitable<Array<{ conceptId: string; activityType: string; diagnosis: string; createdAt: string }>>;
  scheduleReview(input: {
    conceptId: string;
    activityType: EvidenceActivity;
    status: EvidenceStatus;
    assistance: AnswerAssistance;
    at: Date;
  }): Awaitable<void>;
  saveSession(session: StudySession): Awaitable<void>;
  findSession(id: string): Awaitable<StudySession | undefined>;
  findSessionsByConceptIds(conceptIds: string[]): Awaitable<StudySession[]>;
  claimSessionOperation(
    id: string,
    expectedVersion: number,
    operationHash: string,
    leaseToken: string,
  ): Awaitable<number | undefined>;
  renewSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): Awaitable<boolean>;
  completeSessionOperation(
    session: StudySession,
    claimedVersion: number,
    leaseToken: string,
  ): Awaitable<boolean>;
  releaseSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): Awaitable<void>;
  findValidatedConceptIds(): Awaitable<Set<string>>;
  saveConfidence(confidence: ConceptConfidence): Awaitable<void>;
  deleteConfidence(conceptId: string): Awaitable<void>;
  findConfidencesByConceptIds(
    conceptIds: string[],
  ): Awaitable<ConceptConfidence[]>;
  findQuestionBundle(inputHash: string): Awaitable<QuestionBundle | undefined>;
  saveQuestionBundle(materialId: string, inputHash: string, bundle: QuestionBundle): Awaitable<void>;
  findPracticeProjectByHash(
    inputHash: string,
  ): Awaitable<PracticeProject | undefined>;
  findPracticeProject(id: string): Awaitable<PracticeProject | undefined>;
  findPracticeProjectsByMaterial(
    materialId: string,
  ): Awaitable<PracticeProject[]>;
  savePracticeProject(
    project: PracticeProject,
    inputHash: string,
  ): Awaitable<void>;
  findEvaluation(requestHash: string): Awaitable<Evaluation | undefined>;
  saveEvaluation(requestHash: string, evaluation: Evaluation): Awaitable<void>;
  findIsomorphicProblem(
    inputHash: string,
  ): Awaitable<IsomorphicProblem | undefined>;
  saveIsomorphicProblem(
    materialId: string,
    inputHash: string,
    problem: IsomorphicProblem,
  ): Awaitable<void>;
  consumeAiRequest(ownerId: string, dailyLimit: number): Awaitable<number>;
  recordAiUsage(event: AiUsageEvent, ownerId: string): Awaitable<void>;
  getAiUsageToday(
    ownerId: string,
    dailyLimit: number,
  ): Awaitable<AiUsageSummary>;
}
