import { createHash, randomUUID } from 'node:crypto';
import type {
  Concept,
  ConceptConfidence,
  ConceptPerformance,
  EdgeCaseChallenge,
  IsomorphicProblem,
  MasterMeQuestion,
  PracticeProject,
  StudyMaterial,
  StudySession,
  SupportedLocale,
} from '../domain/masterme';
import type { MasterMeRepository } from '../repositories/masterme.repository';
import type { CreateMaterialBody, CreatePracticeProjectBody } from '../schemas/http.schema';
import { ConflictError, NotFoundError } from './errors';
import type { ExtractionProgress, MasterMeLlmGateway } from './llm.gateway';
import { MasterMeTemplateService } from './masterme-template.service';
import { PracticeFocusService } from './practice-focus.service';
import type { PracticeFocus } from './practice-focus.service';
import { isUsefulAssessmentQuestion } from './assessment-quality';

const now = (): string => new Date().toISOString();
const PRACTICE_PROMPT_VERSION = 'practice-project-v2';
const EVALUATION_PROMPT_VERSION = 'evaluation-v2';

export interface KnowledgeMapConcept {
  concept: Concept;
  status: 'READY' | 'REVIEW' | 'EXPLAINED';
  edgeCaseStatus: StudySession['edgeCaseStatus'];
  lastAttempt: StudySession['attempts'][number] | null;
  question: MasterMeQuestion;
}

export class MasterMeService {
  public constructor(
    private readonly repository: MasterMeRepository,
    private readonly llm: MasterMeLlmGateway,
    private readonly templates = new MasterMeTemplateService(),
    private readonly focus = new PracticeFocusService(),
  ) {}

  public async createMaterial(input: CreateMaterialBody, ownerId: string): Promise<StudyMaterial> {
    const material: StudyMaterial = { id: randomUUID(), title: input.title, content: input.content, locale: input.locale ?? 'pt-BR', createdAt: now() };
    await this.repository.saveMaterial(material, ownerId);
    return material;
  }

  public async getMaterial(id: string): Promise<StudyMaterial> {
    return (await this.repository.findMaterial(id)) ?? this.throwNotFound('Material');
  }

  public getAllMaterials(ownerId: string): Promise<StudyMaterial[]> { return this.repository.findAllMaterials(ownerId); }

  public async extractConcepts(
    materialId: string,
    onProgress?: (progress: ExtractionProgress) => Promise<void>,
    shouldPersist: () => Promise<boolean> = async () => true,
  ): Promise<Concept[]> {
    const material = await this.getMaterial(materialId);
    const extracted = await this.llm.extractKnowledge(material, onProgress);
    if (!(await shouldPersist())) throw new ConflictError('A extração foi cancelada.');
    const idsByName = new Map<string, string>();
    for (const fragment of extracted.fragments) {
      const name = fragment.name.trim().toLocaleLowerCase();
      if (idsByName.has(name)) throw new ConflictError('A extração retornou nomes de fragmento duplicados.');
      idsByName.set(name, randomUUID());
    }
    const concepts = extracted.fragments.map((fragment): Concept => {
      if (!material.content.includes(fragment.sourceExcerpt)) throw new ConflictError(`O trecho de origem de "${fragment.name}" não pertence ao material.`);
      const id = idsByName.get(fragment.name.trim().toLocaleLowerCase());
      if (!id) throw new ConflictError('Não foi possível identificar o fragmento extraído.');
      const prerequisiteIds = fragment.prerequisiteNames.map((name) => {
        const prerequisiteId = idsByName.get(name.trim().toLocaleLowerCase());
        if (!prerequisiteId) throw new ConflictError(`Pré-requisito "${name}" não foi extraído.`);
        return prerequisiteId;
      });
      return { id, materialId, name: fragment.name, description: fragment.description, kind: fragment.kind, sourceExcerpt: fragment.sourceExcerpt, fundamentalPremises: fragment.fundamentalPremises, edgeCases: fragment.edgeCases, edgeCaseQuestion: fragment.edgeCaseQuestion, studyQuestion: fragment.studyQuestion, generatedLocale: material.locale, prerequisiteIds, nextIds: [] };
    });
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    for (const concept of concepts) for (const prerequisiteId of concept.prerequisiteIds) {
      const prerequisite = byId.get(prerequisiteId);
      if (prerequisite && !prerequisite.nextIds.includes(concept.id)) prerequisite.nextIds.push(concept.id);
    }
    await this.repository.saveConcepts(concepts);
    return concepts;
  }

  public async getConcepts(materialId: string): Promise<Concept[]> {
    await this.getMaterial(materialId);
    return this.repository.findConceptsByMaterial(materialId);
  }

  public async localizeMaterial(materialId: string, locale: SupportedLocale): Promise<Concept[]> {
    await this.getMaterial(materialId)
    const concepts = await this.repository.findConceptsByMaterial(materialId)
    if (!concepts.length) throw new ConflictError('Extraia os conceitos antes de localizar o conteúdo gerado.')
    if (concepts.every((concept) => concept.generatedLocale === locale)) return concepts
    const localized = await this.llm.localizeKnowledge(concepts, locale)
    const byId = new Map(localized.fragments.map((fragment) => [fragment.id, fragment]))
    if (byId.size !== concepts.length || concepts.some((concept) => !byId.has(concept.id))) {
      throw new ConflictError('A localização retornou um conjunto de conceitos incompatível com o material.')
    }
    const localizedConcepts = concepts.map((concept): Concept => {
      const content = byId.get(concept.id)
      if (!content) throw new ConflictError('A localização omitiu um conceito do material.')
      const studyQuestion = isUsefulAssessmentQuestion(content.questionText, content.requiredIdeas)
        ? {
            text: content.questionText,
            targetPremise: content.targetPremise,
            expectedReasoningSteps: content.expectedReasoningSteps,
            learningObjective: content.learningObjective,
            requiredIdeas: content.requiredIdeas,
            commonMisconceptions: content.commonMisconceptions,
          }
        : undefined
      return {
        ...concept,
        name: content.name,
        description: content.description,
        fundamentalPremises: content.fundamentalPremises,
        edgeCases: content.edgeCases,
        edgeCaseQuestion: isUsefulAssessmentQuestion(content.edgeCaseQuestion) ? content.edgeCaseQuestion : undefined,
        studyQuestion,
        generatedLocale: locale,
      }
    })
    await this.repository.saveConceptLocalizations(materialId, locale, localizedConcepts)
    return localizedConcepts
  }

  public async getKnowledgeMap(materialId: string): Promise<KnowledgeMapConcept[]> {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(concepts.map(({ id }) => id));
    const latest = new Map<string, StudySession>();
    for (const session of sessions) if (!latest.get(session.conceptId) || latest.get(session.conceptId)!.updatedAt < session.updatedAt) latest.set(session.conceptId, session);
    return concepts.map((concept) => {
      const session = latest.get(concept.id);
      const initialAttempts = session?.attempts.filter(({ stage }) => stage === 'INITIAL') ?? [];
      const lastAttempt = initialAttempts.at(-1) ?? null;
      const status = session?.state === 'EXPLANATION_PASSED' ? 'EXPLAINED' : lastAttempt && lastAttempt.evaluation.status !== 'PASSED' ? 'REVIEW' : 'READY';
      return { concept, status, edgeCaseStatus: session?.edgeCaseStatus ?? 'NOT_REQUESTED', lastAttempt, question: this.questionForConcept(concept, concepts, 0, session?.question) };
    });
  }

  public async startSession(conceptId: string): Promise<StudySession> {
    const concept = (await this.repository.findConcept(conceptId)) ?? this.throwNotFound('Conceito');
    const concepts = await this.repository.findConceptsByMaterial(concept.materialId);
    const previous = await this.repository.findSessionsByConceptIds([conceptId]);
    const timestamp = now();
    const session: StudySession = { id: randomUUID(), conceptId, state: 'QUESTION_READY', question: this.questionForConcept(concept, concepts, previous.length), edgeCaseStatus: 'NOT_REQUESTED', edgeCaseChallenge: null, attempts: [], createdAt: timestamp, updatedAt: timestamp };
    await this.repository.saveSession(session);
    return session;
  }

  public async getSession(id: string): Promise<StudySession> {
    return (await this.repository.findSession(id)) ?? this.throwNotFound('Sessão');
  }

  public async evaluateInitialAnswer(sessionId: string, answer: string): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    if (session.attempts.some((attempt) => attempt.stage === 'INITIAL' && attempt.answer === answer)) return session;
    if (session.state !== 'QUESTION_READY' && session.state !== 'RETRY_INITIAL') throw new ConflictError('A sessão não aceita uma resposta inicial neste momento.');
    const concept = (await this.repository.findConcept(session.conceptId)) ?? this.throwNotFound('Conceito');
    const requestHash = this.hash({ version: EVALUATION_PROMPT_VERSION, stage: 'INITIAL', concept, question: session.question, answer });
    const evaluation = (await this.repository.findEvaluation(requestHash)) ?? (await this.llm.evaluateAnswer(concept, session.question, answer));
    await this.repository.saveEvaluation(requestHash, evaluation);
    const updated: StudySession = { ...session, state: evaluation.status === 'PASSED' ? 'EXPLANATION_PASSED' : 'RETRY_INITIAL', attempts: [...session.attempts, { stage: 'INITIAL', answer, evaluation, createdAt: now() }], updatedAt: now() };
    await this.replaceSession(updated, session.state);
    return updated;
  }

  public async requestEdgeCase(sessionId: string): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    if (session.state !== 'EXPLANATION_PASSED') throw new ConflictError('O caso-limite só pode ser solicitado após uma explicação aprovada.');
    if (session.edgeCaseChallenge) return session;
    const concept = (await this.repository.findConcept(session.conceptId)) ?? this.throwNotFound('Conceito');
    const challenge: EdgeCaseChallenge = concept.edgeCaseQuestion && isUsefulAssessmentQuestion(concept.edgeCaseQuestion)
      ? { scenario: concept.edgeCases[0] ?? concept.sourceExcerpt, edgeCaseTested: concept.edgeCases[0] ?? concept.fundamentalPremises[0] ?? concept.name, question: concept.edgeCaseQuestion }
      : await this.llm.generateEdgeCaseChallenge(concept);
    const usefulChallenge = isUsefulAssessmentQuestion(challenge.question)
      ? challenge
      : this.edgeCaseFallback(concept)
    if (concept.edgeCaseQuestion !== usefulChallenge.question) await this.repository.updateConceptEdgeCaseQuestion(concept.id, usefulChallenge.question);
    const updated: StudySession = { ...session, edgeCaseStatus: 'READY', edgeCaseChallenge: usefulChallenge, updatedAt: now() };
    await this.replaceSession(updated, session.state);
    return updated;
  }

  public async evaluateEdgeCaseAnswer(sessionId: string, answer: string): Promise<StudySession> {
    const session = await this.getSession(sessionId);
    if (session.attempts.some((attempt) => (attempt.stage === 'EDGE_CASE_REPLY' || attempt.stage === 'STRESS_REPLY') && attempt.answer === answer)) return session;
    if (session.state !== 'EXPLANATION_PASSED' || !session.edgeCaseChallenge || (session.edgeCaseStatus !== 'READY' && session.edgeCaseStatus !== 'REVIEW')) throw new ConflictError('A sessão não aceita uma resposta de caso-limite neste momento.');
    const concept = (await this.repository.findConcept(session.conceptId)) ?? this.throwNotFound('Conceito');
    const requestHash = this.hash({ version: EVALUATION_PROMPT_VERSION, stage: 'EDGE_CASE_REPLY', concept, challenge: session.edgeCaseChallenge, answer });
    const evaluation = (await this.repository.findEvaluation(requestHash)) ?? (await this.llm.evaluateEdgeCaseAnswer(concept, session.edgeCaseChallenge, answer));
    await this.repository.saveEvaluation(requestHash, evaluation);
    const updated: StudySession = { ...session, edgeCaseStatus: evaluation.status === 'PASSED' ? 'PASSED' : 'REVIEW', attempts: [...session.attempts, { stage: 'EDGE_CASE_REPLY', answer, evaluation, createdAt: now() }], updatedAt: now() };
    await this.replaceSession(updated, session.state);
    return updated;
  }

  public evaluateStressReply(sessionId: string, answer: string): Promise<StudySession> { return this.evaluateEdgeCaseAnswer(sessionId, answer); }

  public async saveConfidence(conceptId: string, value: number): Promise<ConceptConfidence> {
    await this.requireConcept(conceptId);
    const current = (await this.repository.findConfidencesByConceptIds([conceptId]))[0];
    const timestamp = now();
    const confidence: ConceptConfidence = { conceptId, value, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp };
    await this.repository.saveConfidence(confidence);
    return confidence;
  }

  public async deleteConfidence(conceptId: string): Promise<void> { await this.requireConcept(conceptId); await this.repository.deleteConfidence(conceptId); }

  public async getConfidences(materialId: string): Promise<ConceptConfidence[]> {
    const concepts = await this.getConcepts(materialId);
    return this.repository.findConfidencesByConceptIds(concepts.map(({ id }) => id));
  }

  public async getPerformance(materialId: string): Promise<ConceptPerformance[]> {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(concepts.map(({ id }) => id));
    return concepts.map((concept) => {
      const attempts = sessions
        .filter(({ conceptId }) => conceptId === concept.id)
        .flatMap(({ attempts }) => attempts)
        .filter(({ stage }) => stage === 'INITIAL')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const passedAttempts = attempts.filter(({ evaluation }) => evaluation.status === 'PASSED').length;
      const logicalBreaks = attempts.filter(({ evaluation }) => evaluation.status === 'LOGICAL_BREAK').length;
      const incompleteAttempts = attempts.filter(({ evaluation }) => evaluation.status === 'INCOMPLETE').length;
      const totalInitialAttempts = attempts.length;
      const failedInitialAttempts = logicalBreaks + incompleteAttempts;
      const latestStatus = attempts.at(-1)?.evaluation.status ?? null
      const performanceNeed = latestStatus === 'LOGICAL_BREAK' ? 1 : latestStatus === 'INCOMPLETE' ? 0.6 : latestStatus === 'PASSED' ? 0 : null
      return { conceptId: concept.id, passedAttempts, logicalBreaks, incompleteAttempts, totalInitialAttempts, failedInitialAttempts, weakness: totalInitialAttempts ? (2 * logicalBreaks + incompleteAttempts) / (2 * totalInitialAttempts) : null, latestStatus, performanceNeed };
    });
  }

  public async generatePracticeProject(materialId: string, input: CreatePracticeProjectBody): Promise<PracticeProject> {
    const material = await this.getMaterial(materialId);
    const focus = await this.getPracticeFocus(materialId, input);
    const inputHash = this.hash({ version: PRACTICE_PROMPT_VERSION, material: { id: material.id, title: material.title }, concepts: focus.concepts.map(({ id, name, description, sourceExcerpt, fundamentalPremises, edgeCases }) => ({ id, name, description, sourceExcerpt, fundamentalPremises, edgeCases })), focusMode: input.focusMode, conceptIds: input.conceptIds ? [...input.conceptIds].sort() : null, signals: focus.signalSnapshot });
    const cached = await this.repository.findPracticeProjectByHash(inputHash);
    if (cached) return cached;
    const generated = await this.llm.generatePracticeProject(material, focus.concepts, focus.priorities);
    const project: PracticeProject = { id: randomUUID(), materialId, ...generated, prioritizedConcepts: focus.priorities, focusMode: input.focusMode, createdAt: now() };
    await this.repository.savePracticeProject(project, inputHash);
    return project;
  }

  public async getPracticeFocus(materialId: string, input: CreatePracticeProjectBody): Promise<PracticeFocus> {
    const concepts = await this.getConcepts(materialId);
    if (!concepts.length) throw new ConflictError('Extraia os conceitos antes de preparar um Projeto de prática.');
    const confidences = await this.repository.findConfidencesByConceptIds(concepts.map(({ id }) => id));
    const performance = await this.getPerformance(materialId);
    return this.focus.select(input.focusMode, concepts, input.conceptIds, confidences, performance);
  }

  public async getPracticeProjects(materialId: string): Promise<PracticeProject[]> { await this.getMaterial(materialId); return this.repository.findPracticeProjectsByMaterial(materialId); }
  public async getPracticeProject(id: string): Promise<PracticeProject> { return (await this.repository.findPracticeProject(id)) ?? this.throwNotFound('Projeto de prática'); }

  public async generateIsomorphicProblem(materialId: string): Promise<IsomorphicProblem> {
    const context = await this.isomorphicContext(materialId);
    if (!context.concepts.length) throw new ConflictError('Extraia os conceitos antes de gerar um problema isomórfico.');
    const cached = await this.repository.findIsomorphicProblem(context.inputHash);
    if (cached) return cached;
    const problem = await this.llm.generateIsomorphicProblem(context.concepts, context.observedFailures);
    await this.repository.saveIsomorphicProblem(materialId, context.inputHash, problem);
    return problem;
  }

  public async getIsomorphicProblem(materialId: string): Promise<IsomorphicProblem | null> {
    const context = await this.isomorphicContext(materialId);
    return context.concepts.length ? (await this.repository.findIsomorphicProblem(context.inputHash)) ?? null : null;
  }

  public getAiUsageToday(ownerId: string, dailyLimit: number) { return this.repository.getAiUsageToday(ownerId, dailyLimit); }

  private questionForConcept(concept: Concept, concepts: Concept[], sessionNumber: number, persisted?: MasterMeQuestion): MasterMeQuestion { return persisted ?? concept.studyQuestion ?? this.templates.generateQuestion(concept, concepts, sessionNumber); }
  private async requireConcept(id: string): Promise<Concept> { return (await this.repository.findConcept(id)) ?? this.throwNotFound('Conceito'); }
  private async replaceSession(session: StudySession, expectedState: StudySession['state']): Promise<void> { if (!(await this.repository.replaceSession(session, expectedState))) throw new ConflictError('A sessão foi atualizada por outra solicitação. Tente novamente.'); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private throwNotFound(resource: string): never { throw new NotFoundError(resource); }
  private edgeCaseFallback(concept: Concept): EdgeCaseChallenge {
    const scenario = concept.edgeCases[0] ?? concept.sourceExcerpt
    const question = concept.generatedLocale === 'en-US'
      ? `How does the scenario "${scenario}" change the mechanism of ${concept.name}, and which condition must still be preserved?`
      : `Como o cenário “${scenario}” altera o mecanismo de ${concept.name}, e qual condição ainda precisa ser preservada?`
    return { scenario, edgeCaseTested: scenario, question }
  }

  private async isomorphicContext(materialId: string) {
    const concepts = await this.getConcepts(materialId);
    const sessions = await this.repository.findSessionsByConceptIds(concepts.map(({ id }) => id));
    const observedFailures = sessions.flatMap(({ attempts }) => attempts.flatMap(({ evaluation }) => [evaluation.logicalBreak, ...evaluation.missingPremises])).filter((failure): failure is string => failure !== null);
    return { concepts, observedFailures, inputHash: this.hash({ concepts: [...concepts].sort((a, b) => a.id.localeCompare(b.id)), observedFailures: [...observedFailures].sort() }) };
  }
}
