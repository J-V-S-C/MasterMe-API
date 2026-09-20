import { describe, expect, test } from 'bun:test'
import { classifyProcessingFailure } from './ingestion.service'

describe('classifyProcessingFailure', () => {
  test('interrompe retentativas quando a cota diária do provedor acabou', () => {
    const failure = classifyProcessingFailure(new Error('429 Too Many Requests: generate_content_free_tier_requests quota exceeded'))
    expect(failure).toEqual({
      retryable: false,
      message: 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    })
  })

  test('não repete automaticamente falhas de extração', () => {
    expect(classifyProcessingFailure(new Error('network timeout'))).toEqual({
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
})
