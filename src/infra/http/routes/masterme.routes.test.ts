import { describe, expect, spyOn, test } from 'bun:test';
import { Pool } from 'pg';
import type { Server } from 'node:http';
import { createApp } from '../../../../server';
import type { Concept } from '../../../application/domain/concept';
import type { MasterMeQuestion } from '../../../application/domain/assessment';
import type { Evaluation, IsomorphicProblem, EdgeCaseChallenge } from '../../../application/domain/assessment';
import type { PracticeProjectContent } from '../../../application/domain/practice-project';
import type { StudyMaterial } from '../../../application/domain/material';
import { InMemoryMasterMeRepository } from '../../repositories/in-memory/in-memory.masterme.repository';
import type { MasterMeRepository } from '../../../application/repositories/masterme.repository';
import { PostgresMasterMeRepository } from '../../repositories/postgres/postgres-masterme.repository';
import type { ExtractedKnowledge } from '../../../schemas/llm.schema';
import type { MasterMeLlmGateway } from '../../../application/ports/llm.gateway';
import { MasterMeService } from '../../../application/services/masterme.service';
import { MasterMeController } from '../../controllers/masterme.controller';
import { testSecurity } from './test-security';

class EmptyFakeLlm implements MasterMeLlmGateway {
  public async extractKnowledge(
    _material: StudyMaterial,
  ): Promise<ExtractedKnowledge> {
    return { fragments: [] };
  }
  public async localizeKnowledge() {
    return { fragments: [] };
  }
  public async generateQuestion(_concept: Concept): Promise<MasterMeQuestion> {
    throw new Error('Not used in this test.');
  }
  public async evaluateAnswer(
    _concept: Concept,
    _question: MasterMeQuestion,
    _answer: string,
  ): Promise<Evaluation> {
    throw new Error('Not used in this test.');
  }
  public async generateEdgeCaseChallenge(
    _concept: Concept,
  ): Promise<EdgeCaseChallenge> {
    throw new Error('Not used in this test.');
  }
  public async evaluateEdgeCaseAnswer(
    _concept: Concept,
    _challenge: EdgeCaseChallenge,
    _answer: string,
  ): Promise<Evaluation> {
    throw new Error('Not used in this test.');
  }
  public async generatePracticeProject(
    _material: StudyMaterial,
    _concepts: Concept[],
    _priorities: import('../../../application/domain/practice-project').PrioritizedConcept[],
  ): Promise<PracticeProjectContent> {
    throw new Error('Not used in this test.');
  }
  public async generateIsomorphicProblem(
    _concepts: Concept[],
    _observedFailures: string[],
  ): Promise<IsomorphicProblem> {
    throw new Error('Not used in this test.');
  }
}

const withServer = async (
  run: (baseUrl: string) => Promise<void>,
  repository: MasterMeRepository = new InMemoryMasterMeRepository(),
  paymentsEnabled = true,
): Promise<void> => {
  const service = new MasterMeService(repository, new EmptyFakeLlm());
  const server: Server = createApp({ study: new MasterMeController(service, 100), security: testSecurity, paymentsEnabled }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test port is unavailable.');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

describe('guided study routes', () => {
  test('free launch discovery does not advertise unavailable payment routes', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('GET /api/billing/me');
      expect(body).not.toContain('POST /api/billing/checkouts');
      expect(body).not.toContain('POST /api/billing/orders/:id/reconcile');
    }, new InMemoryMasterMeRepository(), false);
  });
  test('does not mount routes without explicit authorization or a pool', () => {
    const service = new MasterMeService(new InMemoryMasterMeRepository(), new EmptyFakeLlm());
    expect(() => createApp({ study: new MasterMeController(service, 100) })).toThrow('explicit security middleware');
  });
  test.each([
    { rows: [] },
    {
      rows: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Primeiro',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Segundo',
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    },
  ])('lista todos os materiais do PostgreSQL: %j', async ({ rows }) => {
    const pool = new Pool();
    const query = spyOn(pool, 'query').mockImplementation(async () => ({
      rows: [...rows],
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    }));
    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/materials`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(
          'private, max-age=0, must-revalidate',
        );
        const etag = response.headers.get('etag');
        expect(etag).toBeTruthy();
        expect(await response.json()).toEqual({
          data: rows.map((row) => ({
            id: row.id,
            title: row.title,
            locale: 'pt-BR',
            createdAt: row.created_at.toISOString(),
          })),
        });
        if (etag)
          expect(
            (
              await fetch(`${baseUrl}/api/materials`, {
                headers: { 'if-none-match': etag },
              })
            ).status,
          ).toBe(304);
        expect(query).toHaveBeenCalledTimes(etag ? 2 : 1);
      }, new PostgresMasterMeRepository(pool));
    } finally {
      query.mockRestore();
      await pool.end();
    }
  });

  test('rejects material without content in validation middleware', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/materials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Vazio', content: '  ' }),
      });
      expect(response.status).toBe(400);
      const payload: unknown = await response.json();
      expect(payload).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  test('material kind correction validates input and keeps ownership', async () => {
    const repository = new InMemoryMasterMeRepository();
    const service = new MasterMeService(repository, new EmptyFakeLlm());
    const own = await service.createMaterial({ title: 'Reading', content: 'A source passage with enough content.' }, '11111111-1111-4111-8111-111111111111');
    const foreign = await service.createMaterial({ title: 'Private', content: 'Another source passage with enough content.' }, '22222222-2222-4222-8222-222222222222');
    await withServer(async (baseUrl) => {
      const update = (id: string, materialKind: string) => fetch(`${baseUrl}/api/materials/${id}/kind`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ materialKind }),
      });
      expect((await update(own.id, 'COURSE')).status).toBe(400);
      expect((await update(foreign.id, 'BOOK')).status).toBe(404);
      const response = await update(own.id, 'BOOK');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { id: own.id, materialKind: 'BOOK' } });
      expect(repository.findMaterial(foreign.id)?.materialKind).toBe('TEXT');
    }, repository);
  });

  test('retrieves an isomorphic problem by material without generating another', async () => {
    const repository = new InMemoryMasterMeRepository();
    const service = new MasterMeService(repository, new EmptyFakeLlm());
    const material = await service.createMaterial(
      { title: 'Exemplo', content: 'Texto de referência.' },
      '00000000-0000-0000-0000-000000000001',
    );
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/materials/${material.id}/isomorphic-problem`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: null });
    }, repository);
  });
});
