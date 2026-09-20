import { describe, expect, test } from 'bun:test'
import { normalizeModelName } from './llm'

describe('normalizeModelName', () => {
  test('substitui modelos removidos ou renomeados sem alterar o .env', () => {
    expect(normalizeModelName('gemini-2.5-flash-lite')).toBe('gemini-3.5-flash-lite')
    expect(normalizeModelName('gemini-3-flash')).toBe('gemini-3-flash-preview')
  })

  test('preserva modelos válidos configurados', () => {
    expect(normalizeModelName('gemini-3.6-flash')).toBe('gemini-3.6-flash')
  })
})
