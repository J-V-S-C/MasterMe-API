import { describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { createApp } from '../../server';
import type { Concept, EdgeCaseChallenge, Evaluation, IsomorphicProblem, MasterMeQuestion, PracticeProjectContent, PrioritizedConcept, StudyMaterial } from '../domain/masterme';
import { InMemoryMasterMeRepository } from '../repositories/masterme.repository';
import type { ExtractedKnowledge } from '../schemas/llm.schema';
import type { MasterMeLlmGateway } from '../services/llm.gateway';
import { MasterMeService } from '../services/masterme.service';

const passed: Evaluation = { status: 'PASSED', missingPremises: [], logicalBreak: null, feedback: 'Correto.' };
class ApiFakeLlm implements MasterMeLlmGateway {
  public async extractKnowledge(): Promise<ExtractedKnowledge> { throw new Error('Não usado.'); }
  public async evaluateAnswer(_concept: Concept, _question: MasterMeQuestion, _answer: string): Promise<Evaluation> { return passed; }
  public async generateEdgeCaseChallenge(_concept: Concept): Promise<EdgeCaseChallenge> { throw new Error('Não usado.'); }
  public async evaluateEdgeCaseAnswer(_concept: Concept, _challenge: EdgeCaseChallenge, _answer: string): Promise<Evaluation> { return passed; }
  public async generatePracticeProject(_material: StudyMaterial, _concepts: Concept[], _priorities: PrioritizedConcept[]): Promise<PracticeProjectContent> { return { title: 'Projeto', context: 'Contexto prático', goal: 'Aplicar o conceito', deliverables: ['Protótipo'], constraints: ['Manter desacoplamento'], firstStep: 'Definir contrato' }; }
  public async generateIsomorphicProblem(): Promise<IsomorphicProblem> { throw new Error('Não usado.'); }
}

const setup = async (run: (baseUrl: string, material: StudyMaterial, concept: Concept) => Promise<void>) => {
  const repository = new InMemoryMasterMeRepository();
  const service = new MasterMeService(repository, new ApiFakeLlm());
  const material = await service.createMaterial({ title: 'Material', content: 'Trecho técnico.' }, '00000000-0000-0000-0000-000000000001');
  const concept: Concept = { id: '11111111-1111-4111-8111-111111111111', materialId: material.id, name: 'Contrato', description: 'Separa política de detalhe.', kind: 'AXIOM', sourceExcerpt: 'Trecho técnico.', fundamentalPremises: ['Detalhes variam.'], edgeCases: ['Não há variação.'], edgeCaseQuestion: 'Quando o contrato não compensa?', studyQuestion: { text: 'Como o contrato protege a política?', targetPremise: 'Detalhes variam.', expectedReasoningSteps: ['Separar política e detalhe'] }, prerequisiteIds: [], nextIds: [] };
  await repository.saveConcepts([concept]);
  const server: Server = createApp(service).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta indisponível.');
  try { await run(`http://127.0.0.1:${address.port}`, material, concept); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

describe('rotas da nova jornada', () => {
  test('cria, lista e remove confiança', async () => setup(async (baseUrl, material, concept) => {
    expect((await fetch(`${baseUrl}/api/concepts/${concept.id}/confidence`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 2 }) })).status).toBe(200);
    const listed = await fetch(`${baseUrl}/api/materials/${material.id}/confidences`);
    expect(await listed.json()).toMatchObject({ data: [{ conceptId: concept.id, value: 2 }] });
    expect((await fetch(`${baseUrl}/api/concepts/${concept.id}/confidence`, { method: 'DELETE' })).status).toBe(204);
  }));

  test('gera, lista e recupera Projeto de prática sem sessão', async () => setup(async (baseUrl, material) => {
    const created = await fetch(`${baseUrl}/api/materials/${material.id}/practice-projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ focusMode: 'OVERVIEW' }) });
    expect(created.status).toBe(201);
    const payload = await created.json() as { data: { id: string } };
    expect((await fetch(`${baseUrl}/api/materials/${material.id}/practice-projects`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/practice-projects/${payload.data.id}`)).status).toBe(200);
  }));

  test('explicação aprovada permite solicitar e responder caso-limite', async () => setup(async (baseUrl, _material, concept) => {
    const started = await fetch(`${baseUrl}/api/concepts/${concept.id}/sessions`, { method: 'POST' });
    const session = await started.json() as { data: { id: string } };
    const answer = 'A política fica estável enquanto o detalhe pode ser substituído.';
    await fetch(`${baseUrl}/api/sessions/${session.data.id}/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) });
    const requested = await fetch(`${baseUrl}/api/sessions/${session.data.id}/edge-case`, { method: 'POST' });
    expect(await requested.json()).toMatchObject({ data: { state: 'EXPLANATION_PASSED', edgeCaseStatus: 'READY' } });
    const reviewed = await fetch(`${baseUrl}/api/sessions/${session.data.id}/edge-case/answers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'Eu compararia o custo do contrato com a chance real de variação.' }) });
    expect(await reviewed.json()).toMatchObject({ data: { state: 'EXPLANATION_PASSED', edgeCaseStatus: 'PASSED' } });
  }));
});
