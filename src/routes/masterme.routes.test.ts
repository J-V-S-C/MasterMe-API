import { describe, expect, spyOn, test } from 'bun:test'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import { createApp } from '../../server'
import type {
  Concept,
  Evaluation,
  IsomorphicProblem,
  MasterMeQuestion,
  EdgeCaseChallenge,
  PracticeProjectContent,
  StudyMaterial,
} from '../domain/masterme'
import { InMemoryMasterMeRepository } from '../repositories/masterme.repository'
import type { MasterMeRepository } from '../repositories/masterme.repository'
import { PostgresMasterMeRepository } from '../repositories/postgres-masterme.repository'
import type { ExtractedKnowledge } from '../schemas/llm.schema'
import type { MasterMeLlmGateway } from '../services/llm.gateway'
import { MasterMeService } from '../services/masterme.service'

class EmptyFakeLlm implements MasterMeLlmGateway {
  public async extractKnowledge(_material: StudyMaterial): Promise<ExtractedKnowledge> { return { fragments: [] } }
  public async generateQuestion(_concept: Concept): Promise<MasterMeQuestion> { throw new Error('Não usado neste teste.') }
  public async evaluateAnswer(_concept: Concept, _question: MasterMeQuestion, _answer: string): Promise<Evaluation> { throw new Error('Não usado neste teste.') }
  public async generateEdgeCaseChallenge(_concept: Concept): Promise<EdgeCaseChallenge> { throw new Error('Não usado neste teste.') }
  public async evaluateEdgeCaseAnswer(_concept: Concept, _challenge: EdgeCaseChallenge, _answer: string): Promise<Evaluation> { throw new Error('Não usado neste teste.') }
  public async generatePracticeProject(_material: StudyMaterial, _concepts: Concept[], _priorities: import('../domain/masterme').PrioritizedConcept[]): Promise<PracticeProjectContent> { throw new Error('Não usado neste teste.') }
  public async generateIsomorphicProblem(_concepts: Concept[], _observedFailures: string[]): Promise<IsomorphicProblem> { throw new Error('Não usado neste teste.') }
}

const withServer = async (run: (baseUrl: string) => Promise<void>, repository: MasterMeRepository = new InMemoryMasterMeRepository()): Promise<void> => {
  const service = new MasterMeService(repository, new EmptyFakeLlm())
  const server: Server = createApp(service).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

describe('rotas de estudo guiado', () => {
  test.each([{ rows: [] }, { rows: [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Primeiro', content: 'Primeiro material', created_at: new Date('2026-01-01T00:00:00.000Z') },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Segundo', content: 'Segundo material', created_at: new Date('2026-01-02T00:00:00.000Z') },
  ] }])('lista todos os materiais do PostgreSQL: %j', async ({ rows }) => {
    const pool = new Pool()
    const query = spyOn(pool, 'query').mockImplementation(async () => ({ rows: [...rows], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] }))
    try {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/materials`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ data: rows.map((row) => ({
          id: row.id, title: row.title, content: row.content, createdAt: row.created_at.toISOString(),
        })) })
        expect(query).toHaveBeenCalledTimes(1)
      }, new PostgresMasterMeRepository(pool))
    } finally {
      query.mockRestore()
      await pool.end()
    }
  })

  test('rejeita material sem conteúdo no middleware de validação', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/materials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Vazio', content: '  ' }),
      })
      expect(response.status).toBe(400)
      const payload: unknown = await response.json()
      expect(payload).toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })

  test('consulta problema isomórfico por material sem gerar outro', async () => {
    const repository = new InMemoryMasterMeRepository()
    const service = new MasterMeService(repository, new EmptyFakeLlm())
    const material = await service.createMaterial({ title: 'Exemplo', content: 'Texto de referência.' }, '00000000-0000-0000-0000-000000000001')
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/materials/${material.id}/isomorphic-problem`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: null })
    }, repository)
  })
})
