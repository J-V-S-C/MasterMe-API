import { createHash, randomUUID } from 'node:crypto';
import type { Concept, ConceptRelation, ConceptConfidence } from '../domain/concept';
import type { AnswerAssistance, ConceptPerformance, EdgeCaseChallenge, IsomorphicProblem, StudySession } from '../domain/assessment';
import type { MaterialKind, MaterialSummary, StudyMaterial, SupportedLocale } from '../domain/material';
import type { PracticeProject } from '../domain/practice-project';
import {
  InvalidStudySessionError,
  StudySessionAggregate,
} from '../domain/study-session';
import type { MasterMeRepository } from '../repositories/masterme.repository';
import { independentAssistance } from '../domain/assessment';
import type {
  CreateMaterialCommand,
  KnowledgeMapConcept,
  PracticeContext,
  PracticeFocusCommand,
} from '../contracts/masterme.service';
import {
  ConflictError,
  NotFoundError,
  SessionConflictError,
  UnprocessableEntityError,
} from '../errors';
import type { ExtractionProgress, MasterMeLlmGateway } from '../ports/llm.gateway';
import type { QuestionBundle } from '../domain/assessment';
import { MAX_BOOK_CONCEPTS_PER_CHAPTER, MAX_QUESTION_VARIANT } from '../study-limits';
import {
  InvalidPracticeFocusError,
  PracticeFocusService,
} from '../domain/practice-focus';
import type { PracticeFocus } from '../domain/practice-focus';
import { focusExcerptOnChapter, passesAssessmentQuestionScreen } from '../prompts/assessment-question';

const now = (): string => new Date().toISOString();
const QUESTION_BUNDLE_VERSION = 'question-bundle-v3';
const PRACTICE_PROMPT_VERSION = 'practice-project-v3';
const EVALUATION_PROMPT_VERSION = 'evaluation-v2';
type RecentLearningGap = { conceptId: string; activityType: string; diagnosis: string; createdAt: string };
const withActivityNeeds = (performance: ConceptPerformance[], gaps: RecentLearningGap[]): ConceptPerformance[] => {
  const active = new Set(gaps.filter((gap) => gap.activityType === 'APPLICATION' || gap.activityType === 'REASONING').map((gap) => gap.conceptId));
  return performance.map((item) => active.has(item.conceptId) ? { ...item, performanceNeed: Math.max(item.performanceNeed ?? 0, 0.8) } : item);
};

export class MasterMeService {
  private readonly pendingQuestionBundles = new Map<string, Promise<QuestionBundle>>();
  public constructor(
    private readonly repository: MasterMeRepository,
    private readonly llm: MasterMeLlmGateway,
    private readonly focus = new PracticeFocusService(),
  ) {}

  public async createMaterial(
    input: CreateMaterialCommand,
    ownerId: string,
  ): Promise<StudyMaterial> {
    const material: StudyMaterial = {
      id: randomUUID(),
      title: input.title,
      content: input.content,
      locale: input.locale ?? 'pt-BR',
      materialKind: input.materialKind ?? 'TEXT',
      createdAt: now(),
    };
    await this.repository.saveMaterial(material, ownerId);
    return material;
  }

  public async getMaterial(id: string): Promise<StudyMaterial> {
    return (
      (await this.repository.findMaterial(id)) ?? this.throwNotFound('Material')
    );
  }

  public getAllMaterials(ownerId: string): Promise<MaterialSummary[]> {
    return this.repository.findAllMaterials(ownerId);
  }

  public async updateMaterialKind(id: string, ownerId: string, kind: MaterialKind): Promise<StudyMaterial> {
    return (await this.repository.updateMaterialKind(id, ownerId, kind)) ?? this.throwNotFound('Material');
  }

  public async extractConcepts(
    materialId: string,
    onProgress?: (progress: ExtractionProgress) => Promise<void>,
    shouldPersist: () => Promise<boolean> = async () => true,
    processingJobId?: string,
    unit?: { id: string; title: string; startOffset: number; endOffset: number; maxConcepts?: number },
  ): Promise<Concept[]> {
    const material = await this.getMaterial(materialId);
    const outline = unit ? [] : await this.repository.findMaterialOutline(materialId);
    const extractionMaterial = unit ? { ...material, content: material.content.slice(unit.startOffset, unit.endOffset), materialKind: 'ARTICLE' as const } : material;
    const chapterConceptLimit = unit
      ? unit.maxConcepts ?? Math.min(MAX_BOOK_CONCEPTS_PER_CHAPTER, Math.max(1, Math.ceil(extractionMaterial.content.length / 6_000)))
      : undefined;
    const extracted = await this.llm.extractKnowledge(extractionMaterial, async (progress) => {
      if (!(await shouldPersist())) throw new ConflictError('A extração foi cancelada.');
      await onProgress?.(progress);
    }, outline, unit ? { maxConcepts: chapterConceptLimit, isBookChapter: true, chapterTitle: unit.title } : undefined);
    if (!(await shouldPersist()))
      throw new ConflictError('A extração foi cancelada.');
    if (unit) {
      for (const fragment of extracted.fragments) {
        if (fragment.sourceOffset === undefined) throw new ConflictError('O trecho extraído não possui âncora no capítulo.');
        fragment.sourceOffset += unit.startOffset;
      }
      for (const relation of extracted.relations ?? []) {
        if (relation.sourceOffset === undefined) throw new ConflictError('A relação extraída não possui âncora no capítulo.');
        relation.sourceOffset += unit.startOffset;
      }
    }
    const idsByName = new Map<string, string>();
    for (const fragment of extracted.fragments) {
      const name = fragment.name.trim().toLocaleLowerCase();
      if (idsByName.has(name))
        throw new ConflictError(
          'A extração retornou nomes de fragmento duplicados.',
        );
      idsByName.set(name, randomUUID());
    }
    const concepts = extracted.fragments.map((fragment): Concept => {
      if (!material.content.includes(fragment.sourceExcerpt) ||
        (fragment.sourceOffset !== undefined && material.content.slice(fragment.sourceOffset, fragment.sourceOffset + fragment.sourceExcerpt.length) !== fragment.sourceExcerpt))
        throw new ConflictError(
          `O trecho de origem de "${fragment.name}" não pertence ao material.`,
        );
      const id = idsByName.get(fragment.name.trim().toLocaleLowerCase());
      if (!id)
        throw new ConflictError(
          'Não foi possível identificar o fragmento extraído.',
        );
      const prerequisiteIds = fragment.prerequisiteNames.map((name) => {
        const prerequisiteId = idsByName.get(name.trim().toLocaleLowerCase());
        if (!prerequisiteId)
          throw new ConflictError(`Pré-requisito "${name}" não foi extraído.`);
        return prerequisiteId;
      });
      return {
        id,
        materialId,
        name: fragment.name,
        description: fragment.description,
        kind: fragment.kind,
        sourceExcerpt: fragment.sourceExcerpt,
        sourceOffset: fragment.sourceOffset,
        fundamentalPremises: fragment.fundamentalPremises,
        edgeCases: fragment.edgeCases,
        edgeCaseQuestion: fragment.edgeCaseQuestion,
        studyQuestion: fragment.studyQuestion,
        generatedLocale: material.locale,
        prerequisiteIds,
        nextIds: [],
      };
    });
    if (concepts.length === 0)
      throw new ConflictError('A extração não retornou conceitos.');
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    for (const concept of concepts)
      for (const prerequisiteId of concept.prerequisiteIds) {
        const prerequisite = byId.get(prerequisiteId);
        if (prerequisite && !prerequisite.nextIds.includes(concept.id))
          prerequisite.nextIds.push(concept.id);
      }
    const relations: ConceptRelation[] = (extracted.relations ?? []).map(
      (relation) => {
        const fromConceptId = idsByName.get(
          relation.fromName.trim().toLocaleLowerCase(),
        );
        const toConceptId = idsByName.get(
          relation.toName.trim().toLocaleLowerCase(),
        );
        if (
          !fromConceptId ||
          !toConceptId ||
          fromConceptId === toConceptId ||
          !material.content.includes(relation.sourceExcerpt) ||
          (relation.sourceOffset !== undefined && material.content.slice(relation.sourceOffset, relation.sourceOffset + relation.sourceExcerpt.length) !== relation.sourceExcerpt)
        )
          throw new ConflictError(
            'A extração retornou uma relação sem fonte ou conceitos válidos.',
          );
        return {
          id: randomUUID(),
          materialId,
          fromConceptId,
          toConceptId,
          relationType: relation.relationType,
          statement: relation.statement,
          justification: relation.justification,
          sourceExcerpt: relation.sourceExcerpt,
          sourceOffset: relation.sourceOffset,
          provenance: 'EXTRACTED',
        };
      },
    );
    await this.repository.saveConcepts(concepts, relations, processingJobId, unit?.id);
    return concepts;
  }

  public async getConcepts(materialId: string): Promise<Concept[]> {
    await this.getMaterial(materialId);
    return this.repository.findConceptsByMaterial(materialId);
  }

  public async localizeMaterial(
    materialId: string,
    locale: SupportedLocale,
  ): Promise<Concept[]> {
    await this.getMaterial(materialId);
    const concepts = await this.repository.findConceptsByMaterial(materialId);
    if (!concepts.length)
      throw new ConflictError(
        'Extraia os conceitos antes de localizar o conteúdo gerado.',
      );
    if (concepts.every((concept) => concept.generatedLocale === locale))
      return concepts;
    const localized = await this.llm.localizeKnowledge(concepts, locale);
    const byId = new Map(
      localized.fragments.map((fragment) => [fragment.id, fragment]),
    );
    if (
      byId.size !== concepts.length ||
      concepts.some((concept) => !byId.has(concept.id))
    ) {
      throw new ConflictError(
        'A localização retornou um conjunto de conceitos incompatível com o material.',
      );
    }
    const localizedConcepts = concepts.map((concept): Concept => {
      const content = byId.get(concept.id);
      if (!content)
        throw new ConflictError(
          'A localização omitiu um conceito do material.',
        );
      return {
        ...concept,
        name: content.name,
        description: content.description,
        fundamentalPremises: content.fundamentalPremises,
        edgeCases: content.edgeCases,
        edgeCaseQuestion: undefined,
        studyQuestion: undefined,
        generatedLocale: locale,
      };
    });
    await this.repository.saveConceptLocalizations(
      materialId,
      locale,
      localizedConcepts,
    );
    return localizedConcepts;
  }

  public async getKnowledgeMap(
    materialId: string,
  ): Promise<KnowledgeMapConcept[]> {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(
      concepts.map(({ id }) => id),
    );
    return this.buildKnowledgeMap(concepts, sessions);
  }

  private buildKnowledgeMap(
    concepts: Concept[],
    sessions: StudySession[],
  ): KnowledgeMapConcept[] {
    const latest = new Map<string, StudySession>();
    const latestAnswered = new Map<string, StudySession>();
    const latestApproved = new Map<string, StudySession>();
    const latestEdge = new Map<string, StudySession>();
    const approved = new Set<string>();
    for (const session of sessions) {
      if (session.state === 'EXPLANATION_PASSED') {
        approved.add(session.conceptId);
        if (!latestApproved.get(session.conceptId) || latestApproved.get(session.conceptId)!.updatedAt < session.updatedAt) latestApproved.set(session.conceptId, session);
      }
      if (session.attempts.some(({ stage }) => stage === 'INITIAL') && (!latestAnswered.get(session.conceptId) || latestAnswered.get(session.conceptId)!.updatedAt < session.updatedAt)) latestAnswered.set(session.conceptId, session);
      if (session.edgeCaseStatus !== 'NOT_REQUESTED' && (!latestEdge.get(session.conceptId) || latestEdge.get(session.conceptId)!.updatedAt < session.updatedAt)) latestEdge.set(session.conceptId, session);
      if (
        !latest.get(session.conceptId) ||
        latest.get(session.conceptId)!.updatedAt < session.updatedAt
      )
        latest.set(session.conceptId, session);
    }
    return concepts.map((concept) => {
      const session = latest.get(concept.id);
      const answeredSession = latestApproved.get(concept.id) ?? latestAnswered.get(concept.id);
      const initialAttempts =
        answeredSession?.attempts.filter(({ stage }) => stage === 'INITIAL') ?? [];
      const lastAttempt = initialAttempts.at(-1) ?? null;
      const status =
        approved.has(concept.id)
          ? 'EXPLAINED'
          : lastAttempt && lastAttempt.evaluation.status !== 'PASSED'
            ? 'REVIEW'
            : 'READY';
      const focused = focusExcerptOnChapter(concept.sourceExcerpt, concept.name);
      const retiredTemplate = session?.question.promptVersion === 'question-bundle-v2' && session.attempts.length === 0 && (
        session.question.text === `Explain how ${concept.name} works and why it matters in this passage.` ||
        session.question.text === `Explique como ${concept.name} funciona e por que é importante neste trecho.`
      );
      return {
        concept: focused.offsetDelta ? { ...concept, sourceExcerpt: focused.text, sourceOffset: concept.sourceOffset === undefined ? undefined : concept.sourceOffset + focused.offsetDelta } : concept,
        status,
        edgeCaseStatus: latestEdge.get(concept.id)?.edgeCaseStatus ?? 'NOT_REQUESTED',
        lastAttempt,
        question: retiredTemplate ? null : (session?.question ?? (concept.studyQuestion && passesAssessmentQuestionScreen(concept.studyQuestion.text, concept.studyQuestion.requiredIdeas)
          ? concept.studyQuestion : null)),
      };
    });
  }

  public async startSession(conceptId: string, ownerId?: string): Promise<StudySession> {
    if (ownerId && !(await this.repository.conceptBelongsToOwner(conceptId, ownerId)))
      this.throwNotFound('Conceito');
    const concept =
      (await this.repository.findConcept(conceptId)) ??
      this.throwNotFound('Conceito');
    const previous = await this.repository.findSessionsByConceptIds([
      conceptId,
    ]);
    const variant = previous.length;
    if (variant > MAX_QUESTION_VARIANT)
      throw new ConflictError('O limite de novas perguntas para este conceito foi atingido.');
    const questions = await this.getQuestionBundle(conceptId, variant, ownerId);
    const timestamp = now();
    const session = StudySessionAggregate.start({
      id: randomUUID(),
      conceptId,
      question: { ...questions.explanation, bundleVariant: variant, promptVersion: QUESTION_BUNDLE_VERSION },
      at: timestamp,
    }).snapshot();
    await this.repository.saveSession(session);
    return session;
  }

  public async getQuestionBundle(conceptId: string, variant = 0, ownerId?: string): Promise<QuestionBundle> {
    if (ownerId && !(await this.repository.conceptBelongsToOwner(conceptId, ownerId)))
      this.throwNotFound('Conceito');
    const concept = (await this.repository.findConcept(conceptId)) ?? this.throwNotFound('Conceito');
    const inputHash = createHash('sha256').update(JSON.stringify({
      version: QUESTION_BUNDLE_VERSION, conceptId, variant,
      name: concept.name, description: concept.description,
      sourceExcerpt: concept.sourceExcerpt, locale: concept.generatedLocale,
    })).digest('hex');
    const cached = await this.repository.findQuestionBundle(inputHash);
    if (cached) return cached;
    const pending = this.pendingQuestionBundles.get(inputHash);
    if (pending) return pending;
    const generation = (async () => {
      const bundle = await this.llm.generateQuestionBundle(concept, variant);
      await this.repository.saveQuestionBundle(concept.materialId, inputHash, bundle);
      return (await this.repository.findQuestionBundle(inputHash)) ?? bundle;
    })();
    this.pendingQuestionBundles.set(inputHash, generation);
    try { return await generation; }
    finally { this.pendingQuestionBundles.delete(inputHash); }
  }

  public async getSession(id: string): Promise<StudySession> {
    return (
      (await this.repository.findSession(id)) ?? this.throwNotFound('Sessão')
    );
  }

  public async getConceptSessions(conceptId: string): Promise<StudySession[]> {
    await this.requireConcept(conceptId);
    const sessions = await this.repository.findSessionsByConceptIds([conceptId]);
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async getMaterialSessions(materialId: string): Promise<{ concepts: Concept[]; activeConceptIds: string[]; sessions: StudySession[] }> {
    await this.getMaterial(materialId);
    const [concepts, activeConcepts] = await Promise.all([
      this.repository.findAllConceptsByMaterial(materialId), this.repository.findConceptsByMaterial(materialId),
    ]);
    if (!concepts.length) return { concepts: [], activeConceptIds: [], sessions: [] };
    return { concepts, activeConceptIds: activeConcepts.map((concept) => concept.id), sessions: await this.repository.findSessionsByConceptIds(concepts.map((concept) => concept.id)) };
  }

  public async evaluateInitialAnswer(
    sessionId: string,
    answer: string,
    assistance: AnswerAssistance = independentAssistance,
  ): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    const aggregate = StudySessionAggregate.rehydrate(session);
    if (aggregate.hasInitialAnswer(answer)) return session;
    this.applySessionRule(() => aggregate.assertCanAnswerInitially());
    const concept =
      (await this.repository.findConcept(session.conceptId)) ??
      this.throwNotFound('Conceito');
    const requestHash = this.hash({
      version: EVALUATION_PROMPT_VERSION,
      stage: 'INITIAL',
      concept,
      question: session.question,
      answer,
    });
    const updated = await this.mutateSession(session, requestHash, async (claimed) => {
      const evaluation =
        (await this.repository.findEvaluation(requestHash)) ??
        (await this.llm.evaluateAnswer(concept, claimed.question, answer));
      await this.repository.saveEvaluation(requestHash, evaluation);
      const current = StudySessionAggregate.rehydrate(claimed);
      this.applySessionRule(() =>
        current.recordInitialAnswer(answer, evaluation, now(), assistance),
      );
      return current.snapshot();
    });
    const latest = [...updated.attempts].reverse().find((attempt) => attempt.stage === 'INITIAL');
    if (latest) {
      try {
        await this.repository.scheduleReview({
          conceptId: updated.conceptId,
          activityType: 'RETENTION',
          status: latest.evaluation.status,
          assistance: latest.assisted === undefined ? assistance : {
            assisted: latest.assisted,
            assistanceLevel: latest.assistanceLevel ?? 0,
            hintsUsed: latest.hintsUsed ?? [],
            solutionRevealed: latest.solutionRevealed ?? false,
          },
          at: new Date(latest.createdAt),
        });
      } catch {
        console.error(JSON.stringify({ level: 'error', operation: 'review-schedule', code: 'REVIEW_SCHEDULE_FAILED' }));
      }
    }
    return updated;
  }

  public async requestEdgeCase(sessionId: string): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    const aggregate = StudySessionAggregate.rehydrate(session);
    this.applySessionRule(() => aggregate.assertCanRequestEdgeCase());
    if (aggregate.hasEdgeCase()) return session;
    const concept =
      (await this.repository.findConcept(session.conceptId)) ??
      this.throwNotFound('Conceito');
    const operationHash = this.hash({
      version: 'session-operation-v1',
      type: 'EDGE_CASE_GENERATION',
      sessionId,
      sessionVersion: session.version,
    });
    return this.mutateSession(session, operationHash, async (claimed) => {
      const bundle = await this.getQuestionBundle(concept.id, claimed.question.bundleVariant ?? 0);
      const challenge: EdgeCaseChallenge = {
        scenario: concept.edgeCases[0] ?? concept.sourceExcerpt,
        edgeCaseTested: concept.edgeCases[0] ?? concept.fundamentalPremises[0] ?? concept.name,
        question: bundle.challenge,
      };
      if (!passesAssessmentQuestionScreen(challenge.question))
        throw new UnprocessableEntityError('A pergunta gerada não passou na validação. Tente gerar novamente.');
      const usefulChallenge = challenge;
      const current = StudySessionAggregate.rehydrate(claimed);
      this.applySessionRule(() =>
        current.requestEdgeCase(usefulChallenge, now()),
      );
      return current.snapshot();
    });
  }

  public async evaluateEdgeCaseAnswer(
    sessionId: string,
    answer: string,
    assistance: AnswerAssistance = independentAssistance,
  ): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    const aggregate = StudySessionAggregate.rehydrate(session);
    if (aggregate.hasEdgeCaseAnswer(answer)) return session;
    const activeChallenge = this.applySessionRule(() =>
      aggregate.assertCanAnswerEdgeCase(),
    );
    const concept =
      (await this.repository.findConcept(session.conceptId)) ??
      this.throwNotFound('Conceito');
    const requestHash = this.hash({
      version: EVALUATION_PROMPT_VERSION,
      stage: 'EDGE_CASE_REPLY',
      concept,
      challenge: activeChallenge,
      answer,
    });
    const updated = await this.mutateSession(session, requestHash, async (claimed) => {
      const current = StudySessionAggregate.rehydrate(claimed);
      const challenge = this.applySessionRule(() =>
        current.assertCanAnswerEdgeCase(),
      );
      const evaluation =
        (await this.repository.findEvaluation(requestHash)) ??
        (await this.llm.evaluateEdgeCaseAnswer(concept, challenge, answer));
      await this.repository.saveEvaluation(requestHash, evaluation);
      this.applySessionRule(() =>
        current.recordEdgeCaseAnswer(answer, evaluation, now(), assistance),
      );
      return current.snapshot();
    });
    const latest = [...updated.attempts].reverse().find((attempt) =>
      attempt.stage === 'EDGE_CASE_REPLY' || attempt.stage === 'STRESS_REPLY');
    if (latest) {
      try {
        await this.repository.scheduleReview({
          conceptId: updated.conceptId,
          activityType: 'APPLICATION',
          status: latest.evaluation.status,
          assistance: latest.assisted === undefined ? assistance : {
            assisted: latest.assisted,
            assistanceLevel: latest.assistanceLevel ?? 0,
            hintsUsed: latest.hintsUsed ?? [],
            solutionRevealed: latest.solutionRevealed ?? false,
          },
          at: new Date(latest.createdAt),
        });
      } catch {
        console.error(JSON.stringify({ level: 'error', operation: 'review-schedule', code: 'REVIEW_SCHEDULE_FAILED' }));
      }
    }
    return updated;
  }

  public evaluateStressReply(
    sessionId: string,
    answer: string,
    assistance: AnswerAssistance = independentAssistance,
  ): Promise<StudySession> {
    return this.evaluateEdgeCaseAnswer(sessionId, answer, assistance);
  }

  public async saveConfidence(
    conceptId: string,
    value: number,
  ): Promise<ConceptConfidence> {
    await this.requireConcept(conceptId);
    const current = (
      await this.repository.findConfidencesByConceptIds([conceptId])
    )[0];
    const timestamp = now();
    const confidence: ConceptConfidence = {
      conceptId,
      value,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveConfidence(confidence);
    return confidence;
  }

  public async deleteConfidence(conceptId: string): Promise<void> {
    await this.requireConcept(conceptId);
    await this.repository.deleteConfidence(conceptId);
  }

  public async getConfidences(
    materialId: string,
  ): Promise<ConceptConfidence[]> {
    const concepts = await this.getConcepts(materialId);
    return this.repository.findConfidencesByConceptIds(
      concepts.map(({ id }) => id),
    );
  }

  public async getPerformance(
    materialId: string,
  ): Promise<ConceptPerformance[]> {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(
      concepts.map(({ id }) => id),
    );
    return this.buildPerformance(concepts, sessions);
  }

  private buildPerformance(
    concepts: Concept[],
    sessions: StudySession[],
  ): ConceptPerformance[] {
    return concepts.map((concept) => {
      const attempts = sessions
        .filter(({ conceptId }) => conceptId === concept.id)
        .flatMap(({ attempts }) => attempts)
        .filter(({ stage }) => stage === 'INITIAL')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const passedAttempts = attempts.filter(
        ({ evaluation }) => evaluation.status === 'PASSED',
      ).length;
      const logicalBreaks = attempts.filter(
        ({ evaluation }) => evaluation.status === 'LOGICAL_BREAK',
      ).length;
      const incompleteAttempts = attempts.filter(
        ({ evaluation }) => evaluation.status === 'INCOMPLETE',
      ).length;
      const totalInitialAttempts = attempts.length;
      const failedInitialAttempts = logicalBreaks + incompleteAttempts;
      const latestStatus = attempts.at(-1)?.evaluation.status ?? null;
      const performanceNeed =
        latestStatus === 'LOGICAL_BREAK'
          ? 1
          : latestStatus === 'INCOMPLETE'
            ? 0.6
            : latestStatus === 'PASSED'
              ? 0
              : null;
      return {
        conceptId: concept.id,
        passedAttempts,
        logicalBreaks,
        incompleteAttempts,
        totalInitialAttempts,
        failedInitialAttempts,
        weakness: totalInitialAttempts
          ? (2 * logicalBreaks + incompleteAttempts) /
            (2 * totalInitialAttempts)
          : null,
        latestStatus,
        performanceNeed,
      };
    });
  }

  public async getPracticeContext(
    materialId: string,
  ): Promise<PracticeContext> {
    const concepts = await this.getConcepts(materialId);
    const ids = concepts.map(({ id }) => id);
    const [sessions, confidences, projects, activityGaps] = await Promise.all([
      this.repository.findSessionsByConceptIds(ids),
      this.repository.findConfidencesByConceptIds(ids),
      this.repository.findPracticeProjectsByMaterial(materialId),
      this.repository.findRecentLearningGaps(ids),
    ]);
    return {
      knowledgeMap: this.buildKnowledgeMap(concepts, sessions),
      confidences,
      performance: withActivityNeeds(this.buildPerformance(concepts, sessions), activityGaps),
      projects,
    };
  }

  public async generatePracticeProject(
    materialId: string,
    input: PracticeFocusCommand,
  ): Promise<PracticeProject> {
    const material = await this.getMaterial(materialId);
    const focus = await this.getPracticeFocus(materialId, input);
    const [sessions, outline, activityGaps] = await Promise.all([
      this.repository.findSessionsByConceptIds(focus.concepts.map((concept) => concept.id)),
      this.repository.findMaterialOutline(materialId),
      this.repository.findRecentLearningGaps(focus.concepts.map((concept) => concept.id)),
    ]);
    const observedGaps = sessions.flatMap((session) => session.attempts
      .filter((attempt) => attempt.evaluation.status !== 'PASSED')
      .map((attempt) => ({ date: attempt.createdAt, gap: attempt.evaluation.gap ?? attempt.evaluation.logicalBreak ?? attempt.evaluation.missingPremises[0] ?? '' })))
      .filter((item) => item.gap).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((item) => item.gap);
    const namedUnits = outline.filter((unit) => unit.title);
    const chapterLevel = [...new Set(namedUnits.map((unit) => unit.level))].sort((a, b) => a - b)
      .find((level) => namedUnits.filter((unit) => unit.level === level).length >= 2) ?? Infinity;
    const chapters = namedUnits.filter((unit) => unit.level === chapterLevel);
    const chapterTitles = chapters.filter((unit, index) => focus.concepts.some((concept) => concept.sourceOffset !== undefined && concept.sourceOffset >= unit.startOffset && concept.sourceOffset < (chapters[index + 1]?.startOffset ?? material.content.length)))
      .map((unit) => unit.title!).slice(0, 8);
    const preferences = { difficulty: input.difficulty, size: input.size, observedGaps: [...activityGaps.map((gap) => `${gap.activityType}: ${gap.diagnosis}`), ...observedGaps].slice(0, 8).map((gap) => gap.slice(0, 500)), chapterTitles };
    const inputHash = this.hash({
      version: PRACTICE_PROMPT_VERSION,
      material: { id: material.id, title: material.title },
      concepts: focus.concepts.map(
        ({
          id,
          name,
          description,
          sourceExcerpt,
          fundamentalPremises,
          edgeCases,
        }) => ({
          id,
          name,
          description,
          sourceExcerpt,
          fundamentalPremises,
          edgeCases,
        }),
      ),
      focusMode: input.focusMode,
      conceptIds: input.conceptIds ? [...input.conceptIds].sort() : null,
      signals: focus.signalSnapshot,
      preferences,
    });
    const cached = await this.repository.findPracticeProjectByHash(inputHash);
    if (cached) return cached;
    const generated = await this.llm.generatePracticeProject(
      material,
      focus.concepts,
      focus.priorities,
      preferences,
    );
    const project: PracticeProject = {
      id: randomUUID(),
      materialId,
      ...generated,
      prioritizedConcepts: focus.priorities,
      focusMode: input.focusMode,
      createdAt: now(),
    };
    await this.repository.savePracticeProject(project, inputHash);
    return project;
  }

  public async getPracticeFocus(
    materialId: string,
    input: PracticeFocusCommand,
  ): Promise<PracticeFocus> {
    const concepts = await this.getConcepts(materialId);
    if (!concepts.length)
      throw new ConflictError(
        'Extraia os conceitos antes de preparar um Projeto de prática.',
      );
    const confidences = await this.repository.findConfidencesByConceptIds(
      concepts.map(({ id }) => id),
    );
    const [initialPerformance, activityGaps] = await Promise.all([
      this.getPerformance(materialId),
      this.repository.findRecentLearningGaps(concepts.map((concept) => concept.id)),
    ]);
    const performance = withActivityNeeds(initialPerformance, activityGaps);
    try {
      const selected = this.focus.select(
        input.focusMode,
        concepts,
        input.conceptIds,
        confidences,
        performance,
      );
      const gapById = new Map<string, RecentLearningGap>();
      for (const gap of activityGaps) if (!gapById.has(gap.conceptId)) gapById.set(gap.conceptId, gap);
      return { ...selected,
        priorities: selected.priorities.map((priority) => {
          const gap = gapById.get(priority.conceptId);
          if (!gap || (input.focusMode !== 'PERFORMANCE' && input.focusMode !== 'COMBINED')) return priority;
          const concept = concepts.find((item) => item.id === priority.conceptId);
          return { ...priority, reason: concept?.generatedLocale === 'en-US'
            ? `recent ${gap.activityType.toLocaleLowerCase()} answer needs review`
            : `resposta recente de ${gap.activityType === 'APPLICATION' ? 'aplicação' : 'raciocínio'} precisa de revisão` };
        }),
        signalSnapshot: { initial: selected.signalSnapshot, activityGaps: activityGaps.map(({ conceptId, activityType, createdAt }) => ({ conceptId, activityType, createdAt })) },
      };
    } catch (error) {
      if (error instanceof InvalidPracticeFocusError)
        throw new UnprocessableEntityError(error.message);
      throw error;
    }
  }

  public async getPracticeProjects(
    materialId: string,
  ): Promise<PracticeProject[]> {
    await this.getMaterial(materialId);
    return this.repository.findPracticeProjectsByMaterial(materialId);
  }
  public async getPracticeProject(id: string): Promise<PracticeProject> {
    return (
      (await this.repository.findPracticeProject(id)) ??
      this.throwNotFound('Projeto de prática')
    );
  }

  public async generateIsomorphicProblem(
    materialId: string,
  ): Promise<IsomorphicProblem> {
    const context = await this.isomorphicContext(materialId);
    if (!context.concepts.length)
      throw new ConflictError(
        'Extraia os conceitos antes de gerar um problema isomórfico.',
      );
    const cached = await this.repository.findIsomorphicProblem(
      context.inputHash,
    );
    if (cached) return cached;
    const problem = await this.llm.generateIsomorphicProblem(
      context.concepts,
      context.observedFailures,
    );
    await this.repository.saveIsomorphicProblem(
      materialId,
      context.inputHash,
      problem,
    );
    return problem;
  }

  public async getIsomorphicProblem(
    materialId: string,
  ): Promise<IsomorphicProblem | null> {
    const context = await this.isomorphicContext(materialId);
    return context.concepts.length
      ? ((await this.repository.findIsomorphicProblem(context.inputHash)) ??
          null)
      : null;
  }

  public getAiUsageToday(ownerId: string, dailyLimit: number) {
    return this.repository.getAiUsageToday(ownerId, dailyLimit);
  }

  private async requireConcept(id: string): Promise<Concept> {
    return (
      (await this.repository.findConcept(id)) ?? this.throwNotFound('Conceito')
    );
  }
  private async mutateSession(
    session: StudySession,
    operationHash: string,
    mutation: (claimed: StudySession) => Promise<StudySession>,
  ): Promise<StudySession> {
    const leaseToken = randomUUID();
    const claimedVersion = await this.repository.claimSessionOperation(
      session.id,
      session.version,
      operationHash,
      leaseToken,
    );
    if (claimedVersion === undefined) throw new SessionConflictError();
    let leaseIsCurrent = true;
    const heartbeat = setInterval(() => {
      void Promise.resolve(
        this.repository.renewSessionOperation(
          session.id,
          claimedVersion,
          leaseToken,
        ),
      )
        .then((renewed) => {
          leaseIsCurrent = leaseIsCurrent && renewed;
        })
        .catch(() => {
          leaseIsCurrent = false;
        });
    }, 60_000);
    heartbeat.unref();
    try {
      const changed = await mutation({ ...session, version: claimedVersion });
      const completed = { ...changed, version: claimedVersion + 1 };
      leaseIsCurrent =
        leaseIsCurrent &&
        (await this.repository.renewSessionOperation(
          session.id,
          claimedVersion,
          leaseToken,
        ));
      if (!leaseIsCurrent) throw new SessionConflictError();
      if (
        !(await this.repository.completeSessionOperation(
          completed,
          claimedVersion,
          leaseToken,
        ))
      )
        throw new SessionConflictError();
      return completed;
    } catch (error: unknown) {
      try {
        await this.repository.releaseSessionOperation(
          session.id,
          claimedVersion,
          leaseToken,
        );
      } catch {
        /* Cleanup failure must not hide the original error. The lease expires safely. */
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private applySessionRule<T>(rule: () => T): T {
    try {
      return rule();
    } catch (error: unknown) {
      if (error instanceof InvalidStudySessionError)
        throw new ConflictError(error.message);
      throw error;
    }
  }
  private throwNotFound(resource: string): never {
    throw new NotFoundError(resource);
  }
  private async isomorphicContext(materialId: string) {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(
      concepts.map(({ id }) => id),
    );
    const observedFailures = sessions
      .flatMap(({ attempts }) =>
        attempts.flatMap(({ evaluation }) => [
          evaluation.logicalBreak,
          ...evaluation.missingPremises,
        ]),
      )
      .filter((failure): failure is string => failure !== null);
    return {
      concepts,
      observedFailures,
      inputHash: this.hash({
        concepts: [...concepts].sort((a, b) => a.id.localeCompare(b.id)),
        observedFailures: [...observedFailures].sort(),
      }),
    };
  }
}
