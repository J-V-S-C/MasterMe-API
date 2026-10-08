import type { Concept, ConceptConfidence, Evaluation, IsomorphicProblem, PracticeProject, StudyMaterial, StudySession, SupportedLocale } from '../domain/masterme';
import type { AiUsageEvent } from '../config/llm';

export type AiUsageSummary = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  dailyLimit: number;
  remainingRequests: number;
  resetsAt: string;
  byModel: Array<{ model: string; requests: number; successes: number; inputTokens: number; outputTokens: number }>;
  byOperation: Array<{ operation: string; requests: number; successes: number; inputTokens: number; outputTokens: number }>;
};

type Awaitable<T> = T | Promise<T>;

export interface MasterMeRepository {
  saveMaterial(material: StudyMaterial, ownerId: string): Awaitable<void>;
  findMaterial(id: string): Awaitable<StudyMaterial | undefined>;
  findAllMaterials(ownerId: string): Promise<StudyMaterial[]>;
  saveConcepts(concepts: Concept[]): Awaitable<void>;
  saveConceptLocalizations(materialId: string, locale: SupportedLocale, concepts: Concept[]): Awaitable<void>;
  findConcept(id: string): Awaitable<Concept | undefined>;
  findConceptsByMaterial(materialId: string): Awaitable<Concept[]>;
  saveSession(session: StudySession): Awaitable<void>;
  findSession(id: string): Awaitable<StudySession | undefined>;
  findSessionsByConceptIds(conceptIds: string[]): Awaitable<StudySession[]>;
  replaceSession(
    session: StudySession,
    expectedState: StudySession['state'],
  ): Awaitable<boolean>;
  findValidatedConceptIds(): Awaitable<Set<string>>;
  saveConfidence(confidence: ConceptConfidence): Awaitable<void>;
  deleteConfidence(conceptId: string): Awaitable<void>;
  findConfidencesByConceptIds(conceptIds: string[]): Awaitable<ConceptConfidence[]>;
  updateConceptEdgeCaseQuestion(conceptId: string, question: string): Awaitable<void>;
  findPracticeProjectByHash(inputHash: string): Awaitable<PracticeProject | undefined>;
  findPracticeProject(id: string): Awaitable<PracticeProject | undefined>;
  findPracticeProjectsByMaterial(materialId: string): Awaitable<PracticeProject[]>;
  savePracticeProject(project: PracticeProject, inputHash: string): Awaitable<void>;
  findEvaluation(requestHash: string): Awaitable<Evaluation | undefined>;
  saveEvaluation(requestHash: string, evaluation: Evaluation): Awaitable<void>;
  findIsomorphicProblem(inputHash: string): Awaitable<IsomorphicProblem | undefined>;
  saveIsomorphicProblem(materialId: string, inputHash: string, problem: IsomorphicProblem): Awaitable<void>;
  consumeAiRequest(ownerId: string, dailyLimit: number): Awaitable<number>;
  recordAiUsage(event: AiUsageEvent, ownerId: string): Awaitable<void>;
  getAiUsageToday(ownerId: string, dailyLimit: number): Awaitable<AiUsageSummary>;
}

export class InMemoryMasterMeRepository implements MasterMeRepository {
  private readonly materials = new Map<string, StudyMaterial>();
  private readonly concepts = new Map<string, Concept>();
  private readonly sessions = new Map<string, StudySession>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly isomorphicProblems = new Map<string, IsomorphicProblem>();
  private readonly confidences = new Map<string, ConceptConfidence>();
  private readonly practiceProjects = new Map<string, PracticeProject>();
  private readonly practiceHashes = new Map<string, string>();
  private readonly aiUsage: Array<AiUsageEvent & { ownerId: string; createdAt: Date }> = [];
  private readonly dailyUsage = new Map<string, number>();
  private readonly materialOwners = new Map<string, string>();

  public saveMaterial(material: StudyMaterial, ownerId: string): void {
    this.materials.set(material.id, material);
    this.materialOwners.set(material.id, ownerId);
  }

  public findMaterial(id: string): StudyMaterial | undefined {
    return this.materials.get(id);
  }

  public async findAllMaterials(ownerId: string): Promise<StudyMaterial[]> {
    return Array.from(this.materials.values()).filter(
      (material) => this.materialOwners.get(material.id) === ownerId,
    );
  }

  public saveConcepts(concepts: Concept[]): void {
    for (const concept of concepts) this.concepts.set(concept.id, concept);
  }

  public saveConceptLocalizations(materialId: string, locale: SupportedLocale, concepts: Concept[]): void {
    const material = this.materials.get(materialId)
    if (material) this.materials.set(materialId, { ...material, locale })
    for (const concept of concepts) this.concepts.set(concept.id, concept)
  }

  public findConcept(id: string): Concept | undefined {
    return this.concepts.get(id);
  }

  public findConceptsByMaterial(materialId: string): Concept[] {
    return [...this.concepts.values()].filter(
      (concept) => concept.materialId === materialId,
    );
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

  public replaceSession(
    session: StudySession,
    expectedState: StudySession['state'],
  ): boolean {
    const current = this.sessions.get(session.id);
    if (!current || current.state !== expectedState) return false;
    this.sessions.set(session.id, session);
    return true;
  }

  public findValidatedConceptIds(): Set<string> {
    return new Set([...this.sessions.values()].filter((session) => session.state === 'EXPLANATION_PASSED').map((session) => session.conceptId));
  }

  public saveConfidence(confidence: ConceptConfidence): void { this.confidences.set(confidence.conceptId, confidence) }
  public deleteConfidence(conceptId: string): void { this.confidences.delete(conceptId) }
  public findConfidencesByConceptIds(conceptIds: string[]): ConceptConfidence[] { const ids = new Set(conceptIds); return [...this.confidences.values()].filter((item) => ids.has(item.conceptId)) }
  public updateConceptEdgeCaseQuestion(conceptId: string, question: string): void { const concept = this.concepts.get(conceptId); if (concept) this.concepts.set(conceptId, { ...concept, edgeCaseQuestion: question }) }
  public findPracticeProjectByHash(inputHash: string): PracticeProject | undefined { const id = this.practiceHashes.get(inputHash); return id ? this.practiceProjects.get(id) : undefined }
  public findPracticeProject(id: string): PracticeProject | undefined { return this.practiceProjects.get(id) }
  public findPracticeProjectsByMaterial(materialId: string): PracticeProject[] { return [...this.practiceProjects.values()].filter((item) => item.materialId === materialId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)) }
  public savePracticeProject(project: PracticeProject, inputHash: string): void { this.practiceProjects.set(project.id, project); this.practiceHashes.set(inputHash, project.id) }

  public findEvaluation(requestHash: string): Evaluation | undefined { return this.evaluations.get(requestHash) }
  public saveEvaluation(requestHash: string, evaluation: Evaluation): void { this.evaluations.set(requestHash, evaluation) }
  public findIsomorphicProblem(inputHash: string): IsomorphicProblem | undefined { return this.isomorphicProblems.get(inputHash) }
  public saveIsomorphicProblem(_materialId: string, inputHash: string, problem: IsomorphicProblem): void { this.isomorphicProblems.set(inputHash, problem) }
  public consumeAiRequest(ownerId: string, dailyLimit: number): number {
    const key = `${ownerId}:${new Date().toISOString().slice(0, 10)}`
    const used = this.dailyUsage.get(key) ?? 0
    if (used >= dailyLimit) return dailyLimit + 1
    this.dailyUsage.set(key, used + 1)
    return used + 1
  }
  public recordAiUsage(event: AiUsageEvent, ownerId: string): void { this.aiUsage.push({ ...event, ownerId, createdAt: new Date() }) }
  public getAiUsageToday(ownerId: string, dailyLimit: number): AiUsageSummary {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const events = this.aiUsage.filter((event) => event.ownerId === ownerId && event.createdAt >= start)
    const used = this.dailyUsage.get(`${ownerId}:${new Date().toISOString().slice(0, 10)}`) ?? 0
    const resetsAt = new Date(); resetsAt.setUTCHours(24, 0, 0, 0)
    const summarize = (selected: typeof events) => ({
      requests: selected.length,
      successes: selected.filter((event) => event.success).length,
      inputTokens: selected.reduce((total, event) => total + (event.inputTokens ?? 0), 0),
      outputTokens: selected.reduce((total, event) => total + (event.outputTokens ?? 0), 0),
    })
    const byModel = [...new Set(events.map((event) => event.model))].map((model) => ({ model, ...summarize(events.filter((event) => event.model === model)) }))
    const byOperation = [...new Set(events.map((event) => event.operation))].map((operation) => ({ operation, ...summarize(events.filter((event) => event.operation === operation)) }))
    return {
      totalRequests: events.length,
      totalInputTokens: events.reduce((total, event) => total + (event.inputTokens ?? 0), 0),
      totalOutputTokens: events.reduce((total, event) => total + (event.outputTokens ?? 0), 0),
      dailyLimit,
      remainingRequests: Math.max(0, dailyLimit - used),
      resetsAt: resetsAt.toISOString(),
      byModel,
      byOperation,
    }
  }
}
