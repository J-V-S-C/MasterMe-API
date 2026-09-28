import { describe, expect, test } from 'bun:test'
import { classifyProcessingFailure } from './ingestion.service'

describe('classifyProcessingFailure', () => {
  test('interrompe retentativas quando a cota diária do provedor acabou', () => {
    const failure = classifyProcessingFailure(new Error('429 Too Many Requests: generate_content_free_tier_requests quota exceeded'))
    expect(failure).toEqual({
      retryable: false,
      retryDelaySeconds: 0,
      message: 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    })
  })

  test('não repete automaticamente falhas definitivas de extração', () => {
    expect(classifyProcessingFailure(new Error('material schema conflict'))).toEqual({
      retryable: false,
      retryDelaySeconds: 0,
      message: 'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias dos modelos Gemini', () => {
    expect(classifyProcessingFailure(new Error('Gemini quota or availability exhausted for all configured models: gemini-3.5-flash-lite'))).toEqual({
      retryable: true,
      retryDelaySeconds: 75,
      message: 'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias de rede', () => {
    expect(classifyProcessingFailure(new Error('Unable to connect. Is the computer able to access the url?'))).toEqual({
      retryable: true,
      retryDelaySeconds: 45,
      message: 'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('aguarda a janela de TPM quando o 429 está na causa do fallback', () => {
    const providerError = new Error('429 RESOURCE_EXHAUSTED: generate_content_free_tier_input_token_count PerModelPerMinute')
    const failure = classifyProcessingFailure(new Error('Gemini quota or availability exhausted for all configured models', { cause: providerError }))
    expect(failure).toEqual({
      retryable: true,
      retryDelaySeconds: 75,
      message: 'O limite temporário de tokens do provedor de IA foi atingido. A extração será retomada após a renovação da janela.',
      code: 'AI_RATE_LIMITED',
    })
  })
})
