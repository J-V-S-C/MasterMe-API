import type { Concept, Evaluation, IsomorphicProblem, StudyMaterial, StudySession } from '../domain/socratic';
import type { AiUsageEvent } from '../config/llm';

export type AiUsageSummary = {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Array<{ model: string; requests: number; successes: number; inputTokens: number; outputTokens: number }>;
  byOperation: Array<{ operation: string; requests: number; successes: number; inputTokens: number; outputTokens: number }>;
};

type Awaitable<T> = T | Promise<T>;

export interface SocraticRepository {
  saveMaterial(material: StudyMaterial): Awaitable<void>;
  findMaterial(id: string): Awaitable<StudyMaterial | undefined>;
  findAllMaterials(): Promise<StudyMaterial[]>;
  saveConcepts(concepts: Concept[]): Awaitable<void>;
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
  findEvaluation(requestHash: string): Awaitable<Evaluation | undefined>;
  saveEvaluation(requestHash: string, evaluation: Evaluation): Awaitable<void>;
  findIsomorphicProblem(inputHash: string): Awaitable<IsomorphicProblem | undefined>;
  saveIsomorphicProblem(materialId: string, inputHash: string, problem: IsomorphicProblem): Awaitable<void>;
  recordAiUsage(event: AiUsageEvent): Awaitable<void>;
  getAiUsageToday(): Awaitable<AiUsageSummary>;
}

export class InMemorySocraticRepository implements SocraticRepository {
  private readonly materials = new Map<string, StudyMaterial>();
  private readonly concepts = new Map<string, Concept>();
  private readonly sessions = new Map<string, StudySession>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly isomorphicProblems = new Map<string, IsomorphicProblem>();
  private readonly aiUsage: Array<AiUsageEvent & { createdAt: Date }> = [];

  public saveMaterial(material: StudyMaterial): void {
    this.materials.set(material.id, material);
  }

  public findMaterial(id: string): StudyMaterial | undefined {
    return this.materials.get(id);
  }

  public async findAllMaterials(): Promise<StudyMaterial[]> {
    return Array.from(this.materials.values());
  }

  public saveConcepts(concepts: Concept[]): void {
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
    return new Set(
      [...this.sessions.values()]
        .filter((session) => session.state === 'VALIDATED')
        .map((session) => session.conceptId),
    );
  }

  public findEvaluation(requestHash: string): Evaluation | undefined { return this.evaluations.get(requestHash) }
  public saveEvaluation(requestHash: string, evaluation: Evaluation): void { this.evaluations.set(requestHash, evaluation) }
  public findIsomorphicProblem(inputHash: string): IsomorphicProblem | undefined { return this.isomorphicProblems.get(inputHash) }
  public saveIsomorphicProblem(_materialId: string, inputHash: string, problem: IsomorphicProblem): void { this.isomorphicProblems.set(inputHash, problem) }
  public recordAiUsage(event: AiUsageEvent): void { this.aiUsage.push({ ...event, createdAt: new Date() }) }
  public getAiUsageToday(): AiUsageSummary {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const events = this.aiUsage.filter((event) => event.createdAt >= start)
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
      byModel,
      byOperation,
    }
  }
}
