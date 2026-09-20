import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type {
  Concept,
  IsomorphicProblem,
  SocraticQuestion,
  StudyMaterial,
  StudySession,
} from '../domain/socratic';
import type { CreateMaterialBody } from '../schemas/http.schema';
import type { SocraticRepository } from '../repositories/socratic.repository';
import { ConflictError, NotFoundError } from './errors';
import type { ExtractionProgress, SocraticLlmGateway } from './llm.gateway';
import { SocraticTemplateService } from './socratic-template.service';

const now = (): string => new Date().toISOString();

export interface KnowledgeMapConcept {
  concept: Concept;
  status: 'LOCKED' | 'READY' | 'VALIDATED' | 'REVIEW';
  lastAttempt: StudySession['attempts'][number] | null;
  question: SocraticQuestion | null;
}

export class SocraticService {
  public constructor(
    private readonly repository: SocraticRepository,
    private readonly llm: SocraticLlmGateway,
    private readonly templates = new SocraticTemplateService(),
  ) {}

  public async createMaterial(
    input: CreateMaterialBody,
  ): Promise<StudyMaterial> {
    const material: StudyMaterial = {
      id: randomUUID(),
      title: input.title,
      content: input.content,
      createdAt: now(),
    };
    await this.repository.saveMaterial(material);
    return material;
  }

  public async getMaterial(id: string): Promise<StudyMaterial> {
    return (
      (await this.repository.findMaterial(id)) ?? this.throwMaterialNotFound()
    );
  }

  public async getAllMaterials(): Promise<StudyMaterial[]> {
    return await this.repository.findAllMaterials();
  }

  public async extractConcepts(materialId: string, onProgress?: (progress: ExtractionProgress) => Promise<void>): Promise<Concept[]> {
    const material = await this.getMaterial(materialId);
    const extracted = await this.llm.extractKnowledge(material, onProgress);
    const names = new Map<string, string>();
    for (const fragment of extracted.fragments) {
      const normalizedName = fragment.name.trim().toLocaleLowerCase();
      if (names.has(normalizedName))
        throw new ConflictError(
          'A extração retornou nomes de fragmento duplicados.',
        );
      names.set(normalizedName, randomUUID());
    }

    const concepts: Concept[] = extracted.fragments.map((fragment) => {
      if (!material.content.includes(fragment.sourceExcerpt)) {
        throw new ConflictError(
          `O trecho de origem de "${fragment.name}" não pertence ao material.`,
        );
      }
      const prerequisiteIds = fragment.prerequisiteNames.map((name) => {
        const prerequisiteId = names.get(name.trim().toLocaleLowerCase());
        if (!prerequisiteId)
          throw new ConflictError(`Pré-requisito "${name}" não foi extraído.`);
        return prerequisiteId;
      });
      const id = names.get(fragment.name.trim().toLocaleLowerCase());
      if (!id)
        throw new ConflictError(
          'Não foi possível identificar o fragmento extraído.',
        );
      return {
        id,
        materialId: material.id,
        name: fragment.name,
        description: fragment.description,
        kind: fragment.kind,
        sourceExcerpt: fragment.sourceExcerpt,
        fundamentalPremises: fragment.fundamentalPremises,
        edgeCases: fragment.edgeCases,
        studyQuestion: fragment.studyQuestion,
        prerequisiteIds,
        nextIds: [],
      };
    });

    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    for (const concept of concepts) {
      for (const prerequisiteId of concept.prerequisiteIds) {
        const prerequisite = byId.get(prerequisiteId);
        if (prerequisite && !prerequisite.nextIds.includes(concept.id))
          prerequisite.nextIds.push(concept.id);
      }
    }
    await this.repository.saveConcepts(concepts);
    return concepts;
  }

  public async getConcepts(materialId: string): Promise<Concept[]> {
    await this.getMaterial(materialId);
    return this.repository.findConceptsByMaterial(materialId);
  }

  public async getKnowledgeMap(materialId: string): Promise<KnowledgeMapConcept[]> {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(
      concepts.map((concept) => concept.id),
    );
    const sessionsByConcept = new Map<string, StudySession>();
    for (const session of sessions) {
      const current = sessionsByConcept.get(session.conceptId);
      if (!current || current.updatedAt < session.updatedAt) sessionsByConcept.set(session.conceptId, session);
    }
    return concepts.map((concept) => {
      const session = sessionsByConcept.get(concept.id);
      const lastAttempt = session?.attempts.at(-1) ?? null;
      const status: KnowledgeMapConcept['status'] = session?.state === 'VALIDATED'
        ? 'VALIDATED'
        : lastAttempt && lastAttempt.evaluation.status !== 'PASSED'
          ? 'REVIEW'
          : 'READY';
      // Toda entrada do mapa já tem uma pergunta própria. A pergunta só é
      // persistida ao iniciar a sessão; enquanto isso, usamos o mesmo
      // gerador determinístico para exibir a prévia sem uma chamada ao LLM.
      return {
        concept,
        status,
        lastAttempt,
        question: this.questionForConcept(concept, concepts, 0, session?.question),
      };
    });
  }

  public async startSession(conceptId: string): Promise<StudySession> {
    const concept =
      (await this.repository.findConcept(conceptId)) ??
      this.throwConceptNotFound();
    const concepts = await this.repository.findConceptsByMaterial(concept.materialId);
    const previousSessions = await this.repository.findSessionsByConceptIds([concept.id]);
    const question = this.questionForConcept(concept, concepts, previousSessions.length);
    const timestamp = now();
    const session: StudySession = {
      id: randomUUID(),
      conceptId: concept.id,
      state: 'QUESTION_READY',
      question,
      stressTest: null,
      attempts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveSession(session);
    return session;
  }

  public async getSession(id: string): Promise<StudySession> {
    return (
      (await this.repository.findSession(id)) ?? this.throwSessionNotFound()
    );
  }

  private questionForConcept(
    concept: Concept,
    concepts: Concept[],
    sessionNumber: number,
    persistedQuestion?: SocraticQuestion,
  ): SocraticQuestion {
    const candidate = persistedQuestion ?? concept.studyQuestion;
    const conceptTerms = concept.name
      .toLocaleLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3);
    const questionText = candidate?.text
      .toLocaleLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') ?? '';
    if (candidate && conceptTerms.some((term) => questionText.includes(term))) return candidate;
    return this.templates.generateQuestion(concept, concepts, sessionNumber);
  }

  public async evaluateInitialAnswer(
    sessionId: string,
    answer: string,
  ): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    if (session.attempts.some((attempt) => attempt.stage === 'INITIAL' && attempt.answer === answer)) return session;
    if (!['QUESTION_READY', 'RETRY_INITIAL'].includes(session.state)) {
      throw new ConflictError(
        'A sessão não aceita uma resposta inicial neste momento.',
      );
    }
    const concept =
      (await this.repository.findConcept(session.conceptId)) ??
      this.throwConceptNotFound();
    const requestHash = this.hash({ stage: 'INITIAL', concept, question: session.question, answer });
    const evaluation = (await this.repository.findEvaluation(requestHash))
      ?? await this.llm.evaluateAnswer(concept, session.question, answer);
    await this.repository.saveEvaluation(requestHash, evaluation);
    const expectedState = session.state;
    const updated: StudySession = {
      ...session,
      state:
        evaluation.status === 'PASSED'
          ? 'AWAITING_STRESS_REPLY'
          : 'RETRY_INITIAL',
      stressTest:
        evaluation.status === 'PASSED'
          ? this.templates.generateStressTest(concept, session.id)
          : null,
      attempts: [
        ...session.attempts,
        { stage: 'INITIAL', answer, evaluation, createdAt: now() },
      ],
      updatedAt: now(),
    };
    if (!(await this.repository.replaceSession(updated, expectedState))) {
      throw new ConflictError(
        'A sessão foi atualizada por outra solicitação. Tente novamente.',
      );
    }
    return updated;
  }

  public async evaluateStressReply(
    sessionId: string,
    answer: string,
  ): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    if (session.attempts.some((attempt) => attempt.stage === 'STRESS_REPLY' && attempt.answer === answer)) return session;
    if (
      !['AWAITING_STRESS_REPLY', 'RETRY_STRESS'].includes(session.state) ||
      !session.stressTest
    ) {
      throw new ConflictError(
        'A sessão não aceita uma réplica ao stress test neste momento.',
      );
    }
    const concept =
      (await this.repository.findConcept(session.conceptId)) ??
      this.throwConceptNotFound();
    const requestHash = this.hash({ stage: 'STRESS_REPLY', concept, stressTest: session.stressTest, answer });
    const evaluation = (await this.repository.findEvaluation(requestHash))
      ?? await this.llm.evaluateStressReply(concept, session.stressTest, answer);
    await this.repository.saveEvaluation(requestHash, evaluation);
    const expectedState = session.state;
    const updated: StudySession = {
      ...session,
      state: evaluation.status === 'PASSED' ? 'VALIDATED' : 'RETRY_STRESS',
      attempts: [
        ...session.attempts,
        { stage: 'STRESS_REPLY', answer, evaluation, createdAt: now() },
      ],
      updatedAt: now(),
    };
    if (!(await this.repository.replaceSession(updated, expectedState))) {
      throw new ConflictError(
        'A sessão foi atualizada por outra solicitação. Tente novamente.',
      );
    }
    return updated;
  }

  public async generateIsomorphicProblem(
    materialId: string,
  ): Promise<IsomorphicProblem> {
    const concepts = await this.getConcepts(materialId);
    if (concepts.length === 0)
      throw new ConflictError(
        'Extraia os conceitos antes de gerar um problema isomórfico.',
      );
    const sessions = await this.repository.findSessionsByConceptIds(
      concepts.map((concept) => concept.id),
    );
    const observedFailures = sessions
      .flatMap((session) =>
        session.attempts.flatMap((attempt) => [
          attempt.evaluation.logicalBreak,
          ...attempt.evaluation.missingPremises,
        ]),
      )
      .filter((failure): failure is string => failure !== null);
    const inputHash = this.hash({
      concepts: [...concepts].sort((left, right) => left.id.localeCompare(right.id)),
      observedFailures: [...observedFailures].sort(),
    });
    const cached = await this.repository.findIsomorphicProblem(inputHash);
    if (cached) return cached;
    const problem = await this.llm.generateIsomorphicProblem(concepts, observedFailures);
    await this.repository.saveIsomorphicProblem(materialId, inputHash, problem);
    return problem;
  }

  public getAiUsageToday() { return this.repository.getAiUsageToday(); }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private throwMaterialNotFound(): never {
    throw new NotFoundError('Material');
  }

  private throwConceptNotFound(): never {
    throw new NotFoundError('Conceito');
  }

  private throwSessionNotFound(): never {
    throw new NotFoundError('Sessão');
  }
}
