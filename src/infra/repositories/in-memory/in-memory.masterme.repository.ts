import type { Concept, ConceptConfidence, ConceptRelation } from '../../../application/domain/concept';
import type { AnswerAssistance, Evaluation, IsomorphicProblem, StudySession } from '../../../application/domain/assessment';
import type { EvidenceActivity, EvidenceStatus } from '../../../application/domain/learning-cycle';
import { decideReview } from '../../../application/domain/review-policy';
import type { MaterialKind, MaterialOutlineUnit, MaterialSummary, StudyMaterial, SupportedLocale } from '../../../application/domain/material';
import type { PracticeProject } from '../../../application/domain/practice-project';
import type { AiUsageEvent } from '../../../application/ports/llm.gateway';
import type { MasterMeRepository, AiUsageSummary } from '../../../application/repositories/masterme.repository';
import { deriveEditorialUnits } from '../../parsers/editorial-structure';

export class InMemoryMasterMeRepository implements MasterMeRepository {
  private readonly materials = new Map<string, StudyMaterial>();
  private readonly materialOutlines = new Map<string, MaterialOutlineUnit[]>();
  private readonly concepts = new Map<string, Concept>();
  private readonly relations = new Map<string, ConceptRelation>();
  private readonly sessions = new Map<string, StudySession>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly isomorphicProblems = new Map<string, IsomorphicProblem>();
  private readonly confidences = new Map<string, ConceptConfidence>();
  private readonly practiceProjects = new Map<string, PracticeProject>();
  private readonly practiceHashes = new Map<string, string>();
  private readonly aiUsage: Array<
    AiUsageEvent & { ownerId: string; createdAt: Date }
  > = [];
  private readonly dailyUsage = new Map<string, number>();
  private readonly materialOwners = new Map<string, string>();
  private readonly reviewSchedules = new Map<string, { intervalDays: number; reviewCount: number; dueAt: Date }>();
  private readonly pendingSessionOperations = new Map<
    string,
    { operationHash: string; leaseToken: string }
  >();

  public saveMaterial(material: StudyMaterial, ownerId: string): void {
    this.materials.set(material.id, material);
    this.materialOwners.set(material.id, ownerId);
  }

  public findMaterial(id: string): StudyMaterial | undefined {
    return this.materials.get(id);
  }

  public findMaterialOutline(id: string): MaterialOutlineUnit[] {
    const material = this.materials.get(id);
    return this.materialOutlines.get(id) ?? (material ? deriveEditorialUnits(material.content, material.sourceType ?? 'TEXT') : []);
  }

  public setMaterialOutline(id: string, outline: MaterialOutlineUnit[]): void {
    this.materialOutlines.set(id, outline);
  }

  public async findAllMaterials(ownerId: string): Promise<MaterialSummary[]> {
    return Array.from(this.materials.values())
      .filter((material) => this.materialOwners.get(material.id) === ownerId)
      .map(({ content: _content, ...summary }) => summary);
  }

  public updateMaterialKind(id: string, ownerId: string, kind: MaterialKind): StudyMaterial | undefined {
    const material = this.materials.get(id);
    if (!material || this.materialOwners.get(id) !== ownerId) return undefined;
    const updated = { ...material, materialKind: kind };
    this.materials.set(id, updated);
    return updated;
  }

  public saveConcepts(
    concepts: Concept[],
    relations: ConceptRelation[] = [],
  ): void {
    for (const concept of concepts) this.concepts.set(concept.id, concept);
    for (const relation of relations) this.relations.set(relation.id, relation);
  }

  public findRelationsByMaterial(materialId: string): ConceptRelation[] {
    return [...this.relations.values()].filter(
      (relation) => relation.materialId === materialId,
    );
  }

  public saveConceptLocalizations(
    materialId: string,
    locale: SupportedLocale,
    concepts: Concept[],
  ): void {
    const material = this.materials.get(materialId);
    if (material) this.materials.set(materialId, { ...material, locale });
    for (const concept of concepts) this.concepts.set(concept.id, concept);
  }

  public findConcept(id: string): Concept | undefined {
    return this.concepts.get(id);
  }

  public findConceptsByMaterial(materialId: string): Concept[] {
    return [...this.concepts.values()].filter(
      (concept) => concept.materialId === materialId,
    );
  }
  public findAllConceptsByMaterial(materialId: string): Concept[] {
    return this.findConceptsByMaterial(materialId);
  }
  public findRecentLearningGaps(_conceptIds: string[]): Array<{ conceptId: string; activityType: string; diagnosis: string; createdAt: string }> {
    return [];
  }

  public scheduleReview(input: {
    conceptId: string;
    activityType: EvidenceActivity;
    status: EvidenceStatus;
    assistance: AnswerAssistance;
    at: Date;
  }): void {
    const previous = this.reviewSchedules.get(input.conceptId);
    const decision = decideReview({
      status: input.status,
      activityType: input.activityType,
      assisted: input.assistance.assisted,
      solutionRevealed: input.assistance.solutionRevealed,
      at: input.at,
      previous,
    });
    if (decision) this.reviewSchedules.set(input.conceptId, {
      intervalDays: decision.intervalDays,
      reviewCount: decision.reviewCount,
      dueAt: decision.dueAt,
    });
  }

  public saveSession(session: StudySession): void {
    this.sessions.set(session.id, session);
  }

  public findSession(id: string): StudySession | undefined {
    return this.sessions.get(id);
  }

  public findSessionsByConceptIds(conceptIds: string[]): StudySession[] {
    const ids = new Set(conceptIds);
    return [...this.sessions.values()].filter((session) =>
      ids.has(session.conceptId),
    );
  }

  public claimSessionOperation(
    id: string,
    expectedVersion: number,
    operationHash: string,
    leaseToken: string,
  ): number | undefined {
    const current = this.sessions.get(id);
    if (
      !current ||
      current.version !== expectedVersion ||
      this.pendingSessionOperations.has(id)
    )
      return undefined;
    this.pendingSessionOperations.set(id, { operationHash, leaseToken });
    return current.version;
  }

  public renewSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): boolean {
    const current = this.sessions.get(id);
    return (
      current?.version === claimedVersion &&
      this.pendingSessionOperations.get(id)?.leaseToken === leaseToken
    );
  }

  public completeSessionOperation(
    session: StudySession,
    claimedVersion: number,
    leaseToken: string,
  ): boolean {
    const current = this.sessions.get(session.id);
    if (
      !current ||
      current.version !== claimedVersion ||
      this.pendingSessionOperations.get(session.id)?.leaseToken !== leaseToken
    )
      return false;
    this.sessions.set(session.id, session);
    this.pendingSessionOperations.delete(session.id);
    return true;
  }

  public releaseSessionOperation(
    id: string,
    claimedVersion: number,
    leaseToken: string,
  ): void {
    const current = this.sessions.get(id);
    if (
      current?.version === claimedVersion &&
      this.pendingSessionOperations.get(id)?.leaseToken === leaseToken
    ) {
      this.pendingSessionOperations.delete(id);
    }
  }

  public findValidatedConceptIds(): Set<string> {
    return new Set(
      [...this.sessions.values()]
        .filter((session) => session.state === 'EXPLANATION_PASSED')
        .map((session) => session.conceptId),
    );
  }

  public saveConfidence(confidence: ConceptConfidence): void {
    this.confidences.set(confidence.conceptId, confidence);
  }
  public deleteConfidence(conceptId: string): void {
    this.confidences.delete(conceptId);
  }
  public findConfidencesByConceptIds(
    conceptIds: string[],
  ): ConceptConfidence[] {
    const ids = new Set(conceptIds);
    return [...this.confidences.values()].filter((item) =>
      ids.has(item.conceptId),
    );
  }
  public updateConceptEdgeCaseQuestion(
    conceptId: string,
    question: string,
  ): void {
    const concept = this.concepts.get(conceptId);
    if (concept)
      this.concepts.set(conceptId, { ...concept, edgeCaseQuestion: question });
  }
  public findPracticeProjectByHash(
    inputHash: string,
  ): PracticeProject | undefined {
    const id = this.practiceHashes.get(inputHash);
    return id ? this.practiceProjects.get(id) : undefined;
  }
  public findPracticeProject(id: string): PracticeProject | undefined {
    return this.practiceProjects.get(id);
  }
  public findPracticeProjectsByMaterial(materialId: string): PracticeProject[] {
    return [...this.practiceProjects.values()]
      .filter((item) => item.materialId === materialId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  public savePracticeProject(
    project: PracticeProject,
    inputHash: string,
  ): void {
    this.practiceProjects.set(project.id, project);
    this.practiceHashes.set(inputHash, project.id);
  }

  public findEvaluation(requestHash: string): Evaluation | undefined {
    return this.evaluations.get(requestHash);
  }
  public saveEvaluation(requestHash: string, evaluation: Evaluation): void {
    this.evaluations.set(requestHash, evaluation);
  }
  public findIsomorphicProblem(
    inputHash: string,
  ): IsomorphicProblem | undefined {
    return this.isomorphicProblems.get(inputHash);
  }
  public saveIsomorphicProblem(
    _materialId: string,
    inputHash: string,
    problem: IsomorphicProblem,
  ): void {
    this.isomorphicProblems.set(inputHash, problem);
  }
  public consumeAiRequest(ownerId: string, dailyLimit: number): number {
    const key = `${ownerId}:${new Date().toISOString().slice(0, 10)}`;
    const used = this.dailyUsage.get(key) ?? 0;
    if (used >= dailyLimit) return dailyLimit + 1;
    this.dailyUsage.set(key, used + 1);
    return used + 1;
  }
  public recordAiUsage(event: AiUsageEvent, ownerId: string): void {
    this.aiUsage.push({ ...event, ownerId, createdAt: new Date() });
  }
  public getAiUsageToday(ownerId: string, dailyLimit: number): AiUsageSummary {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const events = this.aiUsage.filter(
      (event) => event.ownerId === ownerId && event.createdAt >= start,
    );
    const used =
      this.dailyUsage.get(
        `${ownerId}:${new Date().toISOString().slice(0, 10)}`,
      ) ?? 0;
    const resetsAt = new Date();
    resetsAt.setUTCHours(24, 0, 0, 0);
    const summarize = (selected: typeof events) => ({
      requests: selected.length,
      successes: selected.filter((event) => event.success).length,
      inputTokens: selected.reduce(
        (total, event) => total + (event.inputTokens ?? 0),
        0,
      ),
      outputTokens: selected.reduce(
        (total, event) => total + (event.outputTokens ?? 0),
        0,
      ),
    });
    const byModel = [...new Set(events.map((event) => event.model))].map(
      (model) => ({
        model,
        ...summarize(events.filter((event) => event.model === model)),
      }),
    );
    const byOperation = [
      ...new Set(events.map((event) => event.operation)),
    ].map((operation) => ({
      operation,
      ...summarize(events.filter((event) => event.operation === operation)),
    }));
    return {
      totalRequests: events.length,
      totalInputTokens: events.reduce(
        (total, event) => total + (event.inputTokens ?? 0),
        0,
      ),
      totalOutputTokens: events.reduce(
        (total, event) => total + (event.outputTokens ?? 0),
        0,
      ),
      dailyLimit,
      remainingRequests: Math.max(0, dailyLimit - used),
      resetsAt: resetsAt.toISOString(),
      byModel,
      byOperation,
    };
  }
}
