import type { Concept, ConceptConfidence, ConceptRelation } from '../domain/concept';
import type { Evaluation, IsomorphicProblem, StudySession } from '../domain/assessment';
import type { MaterialSummary, StudyMaterial, SupportedLocale } from '../domain/material';
import type { PracticeProject } from '../domain/practice-project';
import type { AiUsageEvent } from '../ports/llm.gateway';

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
  findAllMaterials(ownerId: string): Promise<MaterialSummary[]>;
  saveConcepts(
    concepts: Concept[],
    relations?: ConceptRelation[],
  ): Awaitable<void>;
  saveConceptLocalizations(
    materialId: string,
    locale: SupportedLocale,
    concepts: Concept[],
  ): Awaitable<void>;
  findConcept(id: string): Awaitable<Concept | undefined>;
  findConceptsByMaterial(materialId: string): Awaitable<Concept[]>;
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
  updateConceptEdgeCaseQuestion(
    conceptId: string,
    question: string,
  ): Awaitable<void>;
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
