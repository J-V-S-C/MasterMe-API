import { describe, expect, spyOn, test } from 'bun:test'
import { Pool } from 'pg'
import type { Server } from 'node:http'
import { createApp } from '../../server'
import type {
  Concept,
  Evaluation,
  IsomorphicProblem,
  SocraticQuestion,
  StressTest,
  StudyMaterial,
} from '../domain/socratic'
import { InMemorySocraticRepository } from '../repositories/socratic.repository'
import type { SocraticRepository } from '../repositories/socratic.repository'
import { PostgresSocraticRepository } from '../repositories/postgres-socratic.repository'
import type { ExtractedKnowledge } from '../schemas/llm.schema'
import type { SocraticLlmGateway } from '../services/llm.gateway'
import { SocraticService } from '../services/socratic.service'

class EmptyFakeLlm implements SocraticLlmGateway {
  public async extractKnowledge(_material: StudyMaterial): Promise<ExtractedKnowledge> { return { fragments: [] } }
  public async generateQuestion(_concept: Concept): Promise<SocraticQuestion> { throw new Error('Não usado neste teste.') }
  public async evaluateAnswer(_concept: Concept, _question: SocraticQuestion, _answer: string): Promise<Evaluation> { throw new Error('Não usado neste teste.') }
  public async generateStressTest(_concept: Concept, _answer: string): Promise<StressTest> { throw new Error('Não usado neste teste.') }
  public async evaluateStressReply(_concept: Concept, _stressTest: StressTest, _answer: string): Promise<Evaluation> { throw new Error('Não usado neste teste.') }
  public async generateIsomorphicProblem(_concepts: Concept[], _observedFailures: string[]): Promise<IsomorphicProblem> { throw new Error('Não usado neste teste.') }
}

const withServer = async (run: (baseUrl: string) => Promise<void>, repository: SocraticRepository = new InMemorySocraticRepository()): Promise<void> => {
  const service = new SocraticService(repository, new EmptyFakeLlm())
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

describe('rotas socráticas', () => {
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
      }, new PostgresSocraticRepository(pool))
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
})
