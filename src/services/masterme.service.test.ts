import { describe, expect, test } from 'bun:test';
import type { Concept, EdgeCaseChallenge, Evaluation, IsomorphicProblem, MasterMeQuestion, PracticeProjectContent, StudyMaterial } from '../domain/masterme';
import { InMemoryMasterMeRepository } from '../repositories/masterme.repository';
import type { ExtractedKnowledge } from '../schemas/llm.schema';
import type { MasterMeLlmGateway } from './llm.gateway';
import { MasterMeService } from './masterme.service';

const passed: Evaluation = { status: 'PASSED', missingPremises: [], logicalBreak: null, feedback: 'Correto.' };

class FakeLlm implements MasterMeLlmGateway {
  public projects = 0;
  public initialEvaluations = 0;
  public edgeEvaluations = 0;
  public initialResult: Evaluation = passed;
  public initialError: Error | undefined;
  public initialEvaluationGate: Promise<void> | undefined;
  public edgeEvaluationGate: Promise<void> | undefined;
  public async extractKnowledge(_material: StudyMaterial): Promise<ExtractedKnowledge> {
    return { fragments: [
      { name: 'Abstrações', description: 'Separam regras dos detalhes.', kind: 'AXIOM', sourceExcerpt: 'Regras dependem de abstrações.', fundamentalPremises: ['Detalhes variam.'], edgeCases: ['A abstração não possui variação útil.'], edgeCaseQuestion: 'Quando esta abstração vira complexidade acidental?', studyQuestion: { text: 'Como a abstração protege a regra?', targetPremise: 'Detalhes variam.', expectedReasoningSteps: ['Separar regra e detalhe'] }, prerequisiteNames: [] },
      { name: 'Injeção', description: 'Fornece dependências externamente.', kind: 'NODE', sourceExcerpt: 'Dependências são fornecidas externamente.', fundamentalPremises: ['O consumidor não constrói detalhes.'], edgeCases: ['Existem dependências demais.'], edgeCaseQuestion: 'Como limitar dependências excessivas?', studyQuestion: { text: 'Como o fornecimento externo reduz acoplamento?', targetPremise: 'O consumidor não constrói detalhes.', expectedReasoningSteps: ['Identificar o consumidor'] }, prerequisiteNames: ['Abstrações'] },
    ] };
  }
  public async localizeKnowledge(concepts: Concept[]) {
    return { fragments: concepts.map((concept) => ({
      id: concept.id,
      name: `${concept.name} localizado`,
      description: 'Descrição localizada.',
      fundamentalPremises: ['Premissa localizada.'],
      edgeCases: ['Condição-limite localizada.'],
      edgeCaseQuestion: 'Como a condição-limite altera o mecanismo e qual premissa deve permanecer?',
      questionText: 'Como o mecanismo preserva a premissa quando os detalhes mudam?',
      targetPremise: 'A premissa precisa permanecer.',
      expectedReasoningSteps: ['Identificar a premissa.', 'Explicar o mecanismo.'],
      learningObjective: 'Explicar o mecanismo sem depender de detalhes.',
      requiredIdeas: ['Separação entre regra e detalhe.', 'Efeito causal da separação.'],
      commonMisconceptions: ['Confundir abstração com camada adicional.'],
    })) };
  }
  public async evaluateAnswer(_concept: Concept, _question: MasterMeQuestion, _answer: string): Promise<Evaluation> {
    this.initialEvaluations++;
    await this.initialEvaluationGate;
    if (this.initialError) throw this.initialError;
    return this.initialResult;
  }
  public async generateEdgeCaseChallenge(_concept: Concept): Promise<EdgeCaseChallenge> { return { scenario: 'Legado', edgeCaseTested: 'Limite', question: 'O que ocorre no limite?' }; }
  public async evaluateEdgeCaseAnswer(_concept: Concept, _challenge: EdgeCaseChallenge, _answer: string): Promise<Evaluation> {
    this.edgeEvaluations++;
    await this.edgeEvaluationGate;
    return this.initialResult;
  }
  public async generatePracticeProject(_material: StudyMaterial, _concepts: Concept[], _priorities: import('../domain/masterme').PrioritizedConcept[]): Promise<PracticeProjectContent> { this.projects++; return { title: 'Adaptador de pagamentos', context: 'Construa uma pequena integração desacoplada.', goal: 'Aplicar abstrações.', deliverables: ['Diagrama'], constraints: ['Sem acoplamento ao provedor'], firstStep: 'Liste os contratos.' }; }
  public async generateIsomorphicProblem(_concepts: Concept[], _failures: string[]): Promise<IsomorphicProblem> { return { title: 'Legado', scenario: 'Legado', constraints: ['Uma'], responseInstruction: 'Explique.' }; }
}

const setup = async () => {
  const repository = new InMemoryMasterMeRepository();
  const llm = new FakeLlm();
  const service = new MasterMeService(repository, llm);
  const material = await service.createMaterial({ title: 'Arquitetura', content: 'Regras dependem de abstrações. Dependências são fornecidas externamente.' }, '00000000-0000-0000-0000-000000000001');
  const concepts = await service.extractConcepts(material.id);
  return { service, llm, material, concepts };
};

describe('MasterMeService — jornada livre', () => {
  test('aprovação inicial conclui a explicação sem criar caso-limite', async () => {
    const { service, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    const updated = await service.evaluateInitialAnswer(session.id, 'A regra permanece estável enquanto os detalhes podem variar livremente.');
    expect(updated.state).toBe('EXPLANATION_PASSED');
    expect(updated.edgeCaseStatus).toBe('NOT_REQUESTED');
    expect(updated.edgeCaseChallenge).toBeNull();
  });

  test('duas respostas concorrentes reivindicam a sessão antes de chamar IA', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    let releaseEvaluation = (): void => undefined;
    llm.initialEvaluationGate = new Promise<void>((resolve) => { releaseEvaluation = resolve });

    const winner = service.evaluateInitialAnswer(session.id, 'Primeira explicação concorrente com detalhes suficientes.');
    while (llm.initialEvaluations === 0) await Promise.resolve();
    await expect(service.evaluateInitialAnswer(session.id, 'Segunda explicação concorrente com detalhes suficientes.')).rejects.toMatchObject({
      statusCode: 409,
      code: 'SESSION_CONFLICT',
    });
    expect(llm.initialEvaluations).toBe(1);

    releaseEvaluation();
    const completed = await winner;
    expect(completed.version).toBe(2);
    expect(completed.attempts).toHaveLength(1);
    expect((await service.getSession(session.id)).attempts).toHaveLength(1);
  });

  test('falha da IA libera a mesma versão para uma nova tentativa', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    llm.initialError = new Error('provider unavailable');
    await expect(service.evaluateInitialAnswer(session.id, 'Resposta que falha temporariamente no provedor.')).rejects.toThrow('provider unavailable');
    expect((await service.getSession(session.id)).version).toBe(1);

    llm.initialError = undefined;
    const retried = await service.evaluateInitialAnswer(session.id, 'Resposta que falha temporariamente no provedor.');
    expect(retried.version).toBe(2);
    expect(retried.attempts).toHaveLength(1);
    expect(llm.initialEvaluations).toBe(2);
  });

  test('caso-limite é opt-in, idempotente e falha não rebaixa explicação', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    await service.evaluateInitialAnswer(session.id, 'A regra permanece estável enquanto os detalhes podem variar livremente.');
    const requested = await service.requestEdgeCase(session.id);
    expect((await service.requestEdgeCase(session.id)).edgeCaseChallenge).toEqual(requested.edgeCaseChallenge);
    llm.initialResult = { status: 'INCOMPLETE', missingPremises: ['limite'], logicalBreak: null, feedback: 'Aprofunde.' };
    const reviewed = await service.evaluateEdgeCaseAnswer(session.id, 'Eu avaliaria o custo antes de criar a abstração.');
    expect(reviewed.state).toBe('EXPLANATION_PASSED');
    expect(reviewed.edgeCaseStatus).toBe('REVIEW');
  });

  test('respostas concorrentes do caso-limite iniciam somente uma avaliação', async () => {
    const { service, llm, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    await service.evaluateInitialAnswer(session.id, 'Explicação inicial completa para liberar o caso-limite.');
    await service.requestEdgeCase(session.id);
    let releaseEvaluation = (): void => undefined;
    llm.edgeEvaluationGate = new Promise<void>((resolve) => { releaseEvaluation = resolve });

    const winner = service.evaluateEdgeCaseAnswer(session.id, 'Primeira resposta concorrente para o caso-limite.');
    while (llm.edgeEvaluations === 0) await Promise.resolve();
    await expect(service.evaluateEdgeCaseAnswer(session.id, 'Segunda resposta concorrente para o caso-limite.')).rejects.toMatchObject({
      code: 'SESSION_CONFLICT',
    });
    expect(llm.edgeEvaluations).toBe(1);
    releaseEvaluation();
    expect((await winner).attempts.filter(({ stage }) => stage === 'EDGE_CASE_REPLY')).toHaveLength(1);
  });

  test('desempenho usa apenas tentativas INITIAL e a fórmula ponderada', async () => {
    const { service, llm, material, concepts } = await setup();
    const session = await service.startSession(concepts[0]!.id);
    llm.initialResult = { status: 'LOGICAL_BREAK', missingPremises: [], logicalBreak: 'salto', feedback: 'Revise.' };
    await service.evaluateInitialAnswer(session.id, 'Uma resposta inicial suficientemente longa para avaliação.');
    llm.initialResult = { status: 'INCOMPLETE', missingPremises: [], logicalBreak: null, feedback: 'Complete.' };
    await service.evaluateInitialAnswer(session.id, 'Uma segunda resposta inicial suficientemente longa para avaliação.');
    const item = (await service.getPerformance(material.id)).find(({ conceptId }) => conceptId === concepts[0]!.id);
    expect(item).toMatchObject({ totalInitialAttempts: 2, logicalBreaks: 1, incompleteAttempts: 1, weakness: 0.75 });
  });

  test('gera prática sem sessão e reutiliza cache para a mesma entrada', async () => {
    const { service, llm, material } = await setup();
    const first = await service.generatePracticeProject(material.id, { focusMode: 'OVERVIEW' });
    const second = await service.generatePracticeProject(material.id, { focusMode: 'OVERVIEW' });
    expect(second).toEqual(first);
    expect(first.prioritizedConcepts).toHaveLength(2);
    expect(llm.projects).toBe(1);
    const context = await service.getPracticeContext(material.id);
    expect(context.knowledgeMap).toHaveLength(2);
    expect(context.confidences).toEqual([]);
    expect(context.performance).toHaveLength(2);
    expect(context.projects[0]?.id).toBe(first.id);
  });

  test('confiança pode ser criada, atualizada e removida', async () => {
    const { service, material, concepts } = await setup();
    await service.saveConfidence(concepts[0]!.id, 2);
    expect(await service.getConfidences(material.id)).toHaveLength(1);
    expect((await service.saveConfidence(concepts[0]!.id, 4)).value).toBe(4);
    await service.deleteConfidence(concepts[0]!.id);
    expect(await service.getConfidences(material.id)).toEqual([]);
  });

  test('localiza conteúdo gerado sem alterar trecho-fonte, relações ou IDs', async () => {
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
