import { describe, expect, test } from 'bun:test'
import { parseEnvironment } from './environment'

const required = {
  GEMINI_API_KEY: 'test-key',
  DATABASE_URL: 'postgresql://user:pass@example.com:5432/database',
  SUPABASE_URL: 'https://project.supabase.co',
}

describe('billing configuration', () => {
  test('defaults to the conservative global credit cap', () => {
    expect(parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://masterme.example' }).AI_GLOBAL_DAILY_CREDIT_LIMIT).toBe(500)
  })

  test('defaults extraction pacing below the provider RPM limits', () => {
    expect(parseEnvironment(required).EXTRACTION_REQUESTS_PER_MINUTE).toBe(3)
    expect(() => parseEnvironment({ ...required, EXTRACTION_REQUESTS_PER_MINUTE: '6' })).toThrow()
  })

  test('parses false for the kill switch without unsafe string coercion', () => {
    expect(parseEnvironment({ ...required, AI_CREDITS_ENABLED: 'false' }).AI_CREDITS_ENABLED).toBe(false)
    expect(parseEnvironment({ ...required, AI_CREDITS_ENABLED: 'true' }).AI_CREDITS_ENABLED).toBe(true)
  })

  test('requires an HTTPS origin in production', () => {
    expect(() => parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'http://masterme.example' })).toThrow('HTTPS')
    expect(parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://masterme.example/' }).PUBLIC_APP_URL).toBe('https://masterme.example')
  })

  test('requires HTTPS for Supabase authentication in production', () => {
    expect(() => parseEnvironment({ ...required, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://masterme.example', SUPABASE_URL: 'http://project.supabase.co' })).toThrow('HTTPS')
  })

  test('rejects path, query and fragment in the canonical origin', () => {
    expect(() => parseEnvironment({ ...required, PUBLIC_APP_URL: 'https://masterme.example/app?next=/evil' })).toThrow('somente a origem')
  })

  test('an empty handle disables billing without preventing startup', () => {
    expect(parseEnvironment({ ...required, INFINITEPAY_HANDLE: '' }).INFINITEPAY_HANDLE).toBeUndefined()
  })

  test('metrics token is optional but requires sufficient entropy when configured', () => {
    expect(parseEnvironment({ ...required, METRICS_BEARER_TOKEN: '' }).METRICS_BEARER_TOKEN).toBeUndefined()
    expect(() => parseEnvironment({ ...required, METRICS_BEARER_TOKEN: 'short' })).toThrow()
    expect(parseEnvironment({ ...required, METRICS_BEARER_TOKEN: 'x'.repeat(32) }).METRICS_BEARER_TOKEN).toHaveLength(32)
  })
})
