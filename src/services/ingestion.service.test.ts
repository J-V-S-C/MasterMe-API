import { describe, expect, spyOn, test } from 'bun:test'
import { Pool } from 'pg'
import { classifyProcessingFailure, IngestionService, LocalMaterialStorage } from './ingestion.service'

describe('classifyProcessingFailure', () => {
  test('interrompe retentativas quando a cota diária do provedor acabou', () => {
    const failure = classifyProcessingFailure(new Error('429 Too Many Requests: generate_content_free_tier_requests quota exceeded'))
    expect(failure).toEqual({
      retryable: false,
      message: 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    })
  })

  test('não repete automaticamente falhas definitivas de extração', () => {
    expect(classifyProcessingFailure(new Error('material schema conflict'))).toEqual({
      retryable: false,
      message: 'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias dos modelos Gemini', () => {
    expect(classifyProcessingFailure(new Error('Gemini quota or availability exhausted for all configured models: gemini-3.5-flash-lite'))).toEqual({
      retryable: true,
      message: 'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias de rede', () => {
    expect(classifyProcessingFailure(new Error('Unable to connect. Is the computer able to access the url?'))).toEqual({
      retryable: true,
      message: 'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })
})

describe('eventos de atividade', () => {
  test('persiste e notifica o usuário na mesma instrução PostgreSQL', async () => {
    const pool = new Pool()
    const query = spyOn(pool, 'query').mockImplementation(async () => ({ rows: [{ id: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] }))
    try {
      await new IngestionService(pool, new LocalMaterialStorage('/tmp/masterme-ingestion-test')).event('session.updated', { sessionId: 'session-a' }, '00000000-0000-4000-8000-000000000001')
      const call = query.mock.calls[0] as unknown as [unknown, unknown[]]
      expect(String(call[0])).toContain("pg_notify('masterme_activity'")
      expect(call[1]).toEqual(['session.updated', JSON.stringify({ sessionId: 'session-a' }), '00000000-0000-4000-8000-000000000001'])
    } finally { query.mockRestore(); await pool.end() }
  })
})
