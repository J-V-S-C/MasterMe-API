import { describe, expect, test } from 'bun:test'
import { parseEnvironment } from './environment'

const required = {
  GEMINI_API_KEY: 'test-key',
  DATABASE_URL: 'postgresql://user:pass@example.com:5432/database',
  SUPABASE_URL: 'https://project.supabase.co',
}

describe('configuração comercial', () => {
  test('interpreta false no kill switch sem coerção insegura de string', () => {
    expect(parseEnvironment({ ...required, AI_CREDITS_ENABLED: 'false' }).AI_CREDITS_ENABLED).toBe(false)
    expect(parseEnvironment({ ...required, AI_CREDITS_ENABLED: 'true' }).AI_CREDITS_ENABLED).toBe(true)
  })

  test('exige origem HTTPS em produção', () => {
    expect(() => parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'http://masterme.example' })).toThrow('HTTPS')
    expect(parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://masterme.example/' }).PUBLIC_APP_URL).toBe('https://masterme.example')
  })

  test('rejeita path, query e fragmento na origem canônica', () => {
    expect(() => parseEnvironment({ ...required, PUBLIC_APP_URL: 'https://masterme.example/app?next=/evil' })).toThrow('somente a origem')
  })

  test('handle vazio mantém billing desabilitado sem invalidar o boot', () => {
    expect(parseEnvironment({ ...required, INFINITEPAY_HANDLE: '' }).INFINITEPAY_HANDLE).toBeUndefined()
  })
})
