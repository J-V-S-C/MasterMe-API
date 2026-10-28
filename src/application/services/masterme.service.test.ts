import { describe, expect, test } from 'bun:test';
import type { Concept } from '../domain/concept';
import type { MasterMeQuestion } from '../domain/assessment';
import type { EdgeCaseChallenge, Evaluation, IsomorphicProblem } from '../domain/assessment';
import type { PracticeProjectContent } from '../domain/practice-project';
import type { StudyMaterial } from '../domain/material';
import type { MaterialOutlineUnit } from '../domain/material';
import { InMemoryMasterMeRepository } from '../../infra/repositories/in-memory/in-memory.masterme.repository';
import type { ExtractedKnowledge } from '../../schemas/llm.schema';
import type { MasterMeLlmGateway } from '../ports/llm.gateway';
import { MasterMeService } from './masterme.service';

const passed: Evaluation = {
  status: 'PASSED',
  missingPremises: [],
  logicalBreak: null,
  feedback: 'Correto.',
};

class FakeLlm implements MasterMeLlmGateway {
  public lastOutline: MaterialOutlineUnit[] = [];
  public relations: NonNullable<ExtractedKnowledge['relations']> = [];
  public projects = 0;
  public initialEvaluations = 0;
  public edgeEvaluations = 0;
  public initialResult: Evaluation = passed;
  public initialError: Error | undefined;
  public initialEvaluationGate: Promise<void> | undefined;
  public edgeEvaluationGate: Promise<void> | undefined;
  public async extractKnowledge(
    _material: StudyMaterial,
    _progress?: (progress: import('../ports/llm.gateway').ExtractionProgress) => Promise<void>,
    outline: MaterialOutlineUnit[] = [],
  ): Promise<ExtractedKnowledge> {
    this.lastOutline = outline;
    return {
      fragments: [
        {
          name: 'Abstrações',
          description: 'Separam regras dos detalhes.',
          kind: 'AXIOM',
          sourceExcerpt: 'Regras dependem de abstrações.',
          fundamentalPremises: ['Detalhes variam.'],
          edgeCases: ['A abstração não possui variação útil.'],
          edgeCaseQuestion:
            'Quando esta abstração vira complexidade acidental?',
          studyQuestion: {
            text: 'Como a abstração protege a regra?',
            targetPremise: 'Detalhes variam.',
            expectedReasoningSteps: ['Separar regra e detalhe'],
          },
          prerequisiteNames: [],
        },
        {
          name: 'Injeção',
          description: 'Fornece dependências externamente.',
          kind: 'NODE',
          sourceExcerpt: 'Dependências são fornecidas externamente.',
          fundamentalPremises: ['O consumidor não constrói detalhes.'],
          edgeCases: ['Existem dependências demais.'],
          edgeCaseQuestion: 'Como limitar dependências excessivas?',
          studyQuestion: {
            text: 'Como o fornecimento externo reduz acoplamento?',
            targetPremise: 'O consumidor não constrói detalhes.',
            expectedReasoningSteps: ['Identificar o consumidor'],
          },
          prerequisiteNames: ['Abstrações'],
        },
      ],
      relations: this.relations,
    };
  }
  public async localizeKnowledge(concepts: Concept[]) {
    return {
      fragments: concepts.map((concept) => ({
        id: concept.id,
        name: `${concept.name} localizado`,
        description: 'Descrição localizada.',
        fundamentalPremises: ['Premissa localizada.'],
        edgeCases: ['Condição-limite localizada.'],
        edgeCaseQuestion:
          'Como a condição-limite altera o mecanismo e qual premissa deve permanecer?',
        questionText:
          'Como o mecanismo preserva a premissa quando os detalhes mudam?',
        targetPremise: 'A premissa precisa permanecer.',
        expectedReasoningSteps: [
          'Identificar a premissa.',
          'Explicar o mecanismo.',
        ],
        learningObjective: 'Explicar o mecanismo sem depender de detalhes.',
        requiredIdeas: [
          'Separação entre regra e detalhe.',
          'Efeito causal da separação.',
        ],
        commonMisconceptions: ['Confundir abstração com camada adicional.'],
      })),
    };
  }
  public async evaluateAnswer(
    _concept: Concept,
    _question: MasterMeQuestion,
    _answer: string,
  ): Promise<Evaluation> {
    this.initialEvaluations++;
    await this.initialEvaluationGate;
    if (this.initialError) throw this.initialError;
    return this.initialResult;
  }
  public async generateEdgeCaseChallenge(
    _concept: Concept,
  ): Promise<EdgeCaseChallenge> {
    return {
      scenario: 'Legado',
      edgeCaseTested: 'Limite',
      question: 'O que ocorre no limite?',
    };
  }
  public async evaluateEdgeCaseAnswer(
    _concept: Concept,
    _challenge: EdgeCaseChallenge,
    _answer: string,
  ): Promise<Evaluation> {
    this.edgeEvaluations++;
    await this.edgeEvaluationGate;
    return this.initialResult;
  }
  public async generatePracticeProject(
    _material: StudyMaterial,
    _concepts: Concept[],
    _priorities: import('../domain/practice-project').PrioritizedConcept[],
  ): Promise<PracticeProjectContent> {
    this.projects++;
    return {
      title: 'Adaptador de pagamentos',
      context: 'Construa uma pequena integração desacoplada.',
      goal: 'Aplicar abstrações.',
      deliverables: ['Diagrama'],
      constraints: ['Sem acoplamento ao provedor'],
      firstStep: 'Liste os contratos.',
    };
  }
  public async generateIsomorphicProblem(
    _concepts: Concept[],
    _failures: string[],
  ): Promise<IsomorphicProblem> {
    return {
      title: 'Legado',
      scenario: 'Legado',
      constraints: ['Uma'],
      responseInstruction: 'Explique.',
    };
  }
}

const setup = async () => {
  const repository = new InMemoryMasterMeRepository();
  const llm = new FakeLlm();
  const service = new MasterMeService(repository, llm);
  const material = await service.createMaterial(
    {
      title: 'Arquitetura',
      content:
        'Regras dependem de abstrações. Dependências são fornecidas externamente.',
    },
    '00000000-0000-0000-0000-000000000001',
  );
  const concepts = await service.extractConcepts(material.id);
  return { service, llm, material, concepts };
};

describe('MasterMeService — free journey', () => {
  test('practice focus uses a recent application gap even before an initial explanation', async () => {
    class GapRepository extends InMemoryMasterMeRepository {
      public override findRecentLearningGaps(conceptIds: string[]) {
        return conceptIds.slice(0, 1).map((conceptId) => ({ conceptId, activityType: 'APPLICATION', diagnosis: 'The example lacks a decision rule.', createdAt: '2026-10-27T10:00:00.000Z' }));
      }
    }
    const repository = new GapRepository();
    const service = new MasterMeService(repository, new FakeLlm());
    const material = await service.createMaterial({ title: 'Architecture', content: 'Regras dependem de abstrações. Dependências são fornecidas externamente.' }, '00000000-0000-0000-0000-000000000001');
    await service.extractConcepts(material.id);
    const focus = await service.getPracticeFocus(material.id, { focusMode: 'PERFORMANCE' });
    expect(focus.priorities).toHaveLength(1);
    expect(focus.priorities[0]?.reason).toContain('aplicação');
  });
  test('lists saved sessions for a material in one request', async () => {
    const { service, material, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    const history = await service.getMaterialSessions(material.id);
    expect(history.concepts.map((concept) => concept.id)).toContain(concepts[0]!.id);
    expect(history.sessions.map((item) => item.id)).toContain(session.id);
  });
  test('passes the saved book outline to extraction', async () => {
    const repository = new InMemoryMasterMeRepository();
    const llm = new FakeLlm();
    const service = new MasterMeService(repository, llm);
    const material = await service.createMaterial({ title: 'Book', content: 'Regras dependem de abstrações. Dependências são fornecidas externamente.' }, '00000000-0000-0000-0000-000000000001');
    const outline: MaterialOutlineUnit[] = [{ order: 0, title: 'Chapter 1. Foundations', level: 1, startOffset: 0, endOffset: material.content.length, provenance: 'HEADING' }];
    repository.setMaterialOutline(material.id, outline);
    await service.extractConcepts(material.id);
    expect(llm.lastOutline).toEqual(outline);
  });

  test('replaces an unsupported registry question while keeping the cited chapter in view', async () => {
    const repository = new InMemoryMasterMeRepository();
    const service = new MasterMeService(repository, new FakeLlm());
    const source = 'Pipeline architectures have monolithic deployments.\nChapter 12. Microkernel Architecture Style\nA microkernel has a core system and plug-in components.';
    const material: StudyMaterial = { id: '11111111-1111-4111-8111-111111111111', title: 'Architecture', content: source, locale: 'en-US', createdAt: new Date().toISOString() };
    repository.saveMaterial(material, '22222222-2222-4222-8222-222222222222');
    const concept: Concept = {
      id: '33333333-3333-4333-8333-333333333333', materialId: material.id,
      name: 'MicrokernelArchitecture', description: 'A core and plug-in components.', kind: 'NODE',
      sourceExcerpt: source, sourceOffset: 0, fundamentalPremises: ['A core and plug-in components.'], edgeCases: [],
      studyQuestion: { text: 'Explain how the microkernel architecture style uses a plug-in registry to invoke specialized electronic device assessment components dynamically.', targetPremise: 'A registry invokes components.', expectedReasoningSteps: ['Find registry', 'Invoke components'] },
      generatedLocale: 'en-US', prerequisiteIds: [], nextIds: [],
    };
    await repository.saveConcepts([concept]);
    const map = await service.getKnowledgeMap(material.id);
    expect(map[0]?.concept.sourceExcerpt.startsWith('Chapter 12.')).toBe(true);
    expect(map[0]?.concept.sourceOffset).toBe(source.indexOf('Chapter 12.'));
    expect(map[0]?.question.text).toContain('selected passage');
    const session = await service.startSession(concept.id);
    expect(session.question.text).toBe(map[0]!.question.text);
  });

  test('persists relations only when both concepts and the excerpt belong to the material', async () => {
    const repository = new InMemoryMasterMeRepository();
    const llm = new FakeLlm();
    const service = new MasterMeService(repository, llm);
    const material = await service.createMaterial(
      {
        title: 'Arquitetura',
        content:
          'Regras dependem de abstrações. Dependências são fornecidas externamente.',
      },
      '00000000-0000-0000-0000-000000000001',
    );
    llm.relations = [
      {
        fromName: 'Abstrações',
        toName: 'Injeção',
        relationType: 'ENABLES',
        statement: 'Abstrações permitem injeção.',
        justification: 'A regra não constrói detalhes.',
        sourceExcerpt: 'Regras dependem de abstrações.',
      },
    ];
    const concepts = await service.extractConcepts(material.id);
    expect(repository.findRelationsByMaterial(material.id)).toMatchObject([
      {
        fromConceptId: concepts[0]!.id,
        toConceptId: concepts[1]!.id,
        provenance: 'EXTRACTED',
      },
    ]);
    const other = await service.createMaterial(
      {
        title: 'Outro',
        content:
          'Regras dependem de abstrações. Dependências são fornecidas externamente.',
      },
      '00000000-0000-0000-0000-000000000001',
    );
    llm.relations = [
      { ...llm.relations[0]!, sourceExcerpt: 'Trecho inventado.' },
    ];
    await expect(service.extractConcepts(other.id)).rejects.toThrow(
      'relação sem fonte',
    );
    expect(repository.findConceptsByMaterial(other.id)).toHaveLength(0);
  });
  test('initial approval completes the explanation without creating an edge case', async () => {
    const { service, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    const updated = await service.evaluateInitialAnswer(
      session.id,
      'A regra permanece estável enquanto os detalhes podem variar livremente.',
    );
    expect(updated.state).toBe('EXPLANATION_PASSED');
    expect(updated.edgeCaseStatus).toBe('NOT_REQUESTED');
    expect(updated.edgeCaseChallenge).toBeNull();
  });

  test('a new attempt keeps the approved explanation and makes both sessions available', async () => {
    const { service, concepts, material } = await setup();
    const conceptId = concepts[0]!.id;
    const first = await service.startSession(conceptId);
    await service.evaluateInitialAnswer(first.id, 'A regra permanece estável enquanto os detalhes podem variar livremente.');
    const repeat = await service.startSession(conceptId);

    expect(repeat.id).not.toBe(first.id);
    expect((await service.getKnowledgeMap(material.id)).find((node) => node.concept.id === conceptId)).toMatchObject({
      status: 'EXPLAINED',
      lastAttempt: { evaluation: { status: 'PASSED' } },
    });
    expect((await service.getConceptSessions(conceptId)).map((session) => session.id)).toContain(first.id);
    expect((await service.getConceptSessions(conceptId)).map((session) => session.id)).toContain(repeat.id);
  });

  test('concurrent answers claim the session before calling AI', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    let releaseEvaluation = (): void => undefined;
    llm.initialEvaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });

    const winner = service.evaluateInitialAnswer(
      session.id,
      'Primeira explicação concorrente com detalhes suficientes.',
    );
    while (llm.initialEvaluations === 0) await Promise.resolve();
    await expect(
      service.evaluateInitialAnswer(
        session.id,
        'Segunda explicação concorrente com detalhes suficientes.',
      ),
    ).rejects.toMatchObject({
      code: 'SESSION_CONFLICT',
    });
    expect(llm.initialEvaluations).toBe(1);

    releaseEvaluation();
    const completed = await winner;
    expect(completed.version).toBe(2);
    expect(completed.attempts).toHaveLength(1);
    expect((await service.getSession(session.id)).attempts).toHaveLength(1);
  });

  test('AI failure releases the same version for another attempt', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    llm.initialError = new Error('provider unavailable');
    await expect(
      service.evaluateInitialAnswer(
        session.id,
        'Resposta que falha temporariamente no provedor.',
      ),
    ).rejects.toThrow('provider unavailable');
    expect((await service.getSession(session.id)).version).toBe(1);

    llm.initialError = undefined;
    const retried = await service.evaluateInitialAnswer(
      session.id,
      'Resposta que falha temporariamente no provedor.',
    );
    expect(retried.version).toBe(2);
    expect(retried.attempts).toHaveLength(1);
    expect(llm.initialEvaluations).toBe(2);
  });

  test('edge case is opt-in and idempotent and failure does not downgrade the explanation', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    await service.evaluateInitialAnswer(
      session.id,
      'A regra permanece estável enquanto os detalhes podem variar livremente.',
    );
    const requested = await service.requestEdgeCase(session.id);
    expect(
      (await service.requestEdgeCase(session.id)).edgeCaseChallenge,
    ).toEqual(requested.edgeCaseChallenge);
    llm.initialResult = {
      status: 'INCOMPLETE',
      missingPremises: ['limite'],
      logicalBreak: null,
      feedback: 'Aprofunde.',
    };
    const reviewed = await service.evaluateEdgeCaseAnswer(
      session.id,
      'Eu avaliaria o custo antes de criar a abstração.',
    );
    expect(reviewed.state).toBe('EXPLANATION_PASSED');
    expect(reviewed.edgeCaseStatus).toBe('REVIEW');
  });

  test('concurrent edge-case answers start only one evaluation', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    await service.evaluateInitialAnswer(
      session.id,
      'Explicação inicial completa para liberar o caso-limite.',
    );
    await service.requestEdgeCase(session.id);
    let releaseEvaluation = (): void => undefined;
    llm.edgeEvaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });

    const winner = service.evaluateEdgeCaseAnswer(
      session.id,
      'Primeira resposta concorrente para o caso-limite.',
    );
    while (llm.edgeEvaluations === 0) await Promise.resolve();
    await expect(
      service.evaluateEdgeCaseAnswer(
        session.id,
        'Segunda resposta concorrente para o caso-limite.',
      ),
    ).rejects.toMatchObject({
      code: 'SESSION_CONFLICT',
    });
    expect(llm.edgeEvaluations).toBe(1);
    releaseEvaluation();
    expect(
      (await winner).attempts.filter(
        ({ stage }) => stage === 'EDGE_CASE_REPLY',
      ),
    ).toHaveLength(1);
  });

  test('performance uses only INITIAL attempts and the weighted formula', async () => {
    const { service, llm, material, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    llm.initialResult = {
      status: 'LOGICAL_BREAK',
      missingPremises: [],
      logicalBreak: 'salto',
      feedback: 'Revise.',
    };
    await service.evaluateInitialAnswer(
      session.id,
      'Uma resposta inicial suficientemente longa para avaliação.',
    );
    llm.initialResult = {
      status: 'INCOMPLETE',
      missingPremises: [],
      logicalBreak: null,
      feedback: 'Complete.',
    };
    await service.evaluateInitialAnswer(
      session.id,
      'Uma segunda resposta inicial suficientemente longa para avaliação.',
    );
    const item = (await service.getPerformance(material.id)).find(
      ({ conceptId }) => conceptId === concepts[0]!.id,
    );
    expect(item).toMatchObject({
      totalInitialAttempts: 2,
      logicalBreaks: 1,
      incompleteAttempts: 1,
      weakness: 0.75,
    });
  });

  test('generates practice without a session and reuses the cache for identical input', async () => {
    const { service, llm, material } = await setup();
    const first = await service.generatePracticeProject(material.id, {
      focusMode: 'OVERVIEW',
    });
    const second = await service.generatePracticeProject(material.id, {
      focusMode: 'OVERVIEW',
    });
    expect(second).toEqual(first);
    expect(first.prioritizedConcepts).toHaveLength(2);
    expect(llm.projects).toBe(1);
    const context = await service.getPracticeContext(material.id);
    expect(context.knowledgeMap).toHaveLength(2);
    expect(context.confidences).toEqual([]);
    expect(context.performance).toHaveLength(2);
    expect(context.projects[0]?.id).toBe(first.id);
  });

  test('confidence can be created, updated and removed', async () => {
    const { service, material, concepts } = await setup();
    await service.saveConfidence(concepts[0]!.id, 2);
    expect(await service.getConfidences(material.id)).toHaveLength(1);
    expect((await service.saveConfidence(concepts[0]!.id, 4)).value).toBe(4);
    await service.deleteConfidence(concepts[0]!.id);
    expect(await service.getConfidences(material.id)).toEqual([]);
  });

  test('localizes generated content without changing source excerpts, relations or IDs', async () => {
    const { service, material, concepts } = await setup();
    const localized = await service.localizeMaterial(material.id, 'en-US');
    expect(localized[0]).toMatchObject({
      id: concepts[0]!.id,
      sourceExcerpt: concepts[0]!.sourceExcerpt,
      prerequisiteIds: concepts[0]!.prerequisiteIds,
      generatedLocale: 'en-US',
    });
    expect((await service.getMaterial(material.id)).locale).toBe('en-US');
  });
});
