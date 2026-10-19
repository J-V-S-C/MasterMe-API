import { describe, expect, test } from 'bun:test'
import { indexMaterialParagraphs, relationNamesInExcerpt, splitMaterialForExtraction } from './gemini.gateway'

describe('splitMaterialForExtraction', () => {
  test('preserves all content and prefers paragraph boundaries', () => {
    const content = 'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.'
    expect(splitMaterialForExtraction(content, 25)).toEqual([
      'Primeiro parágrafo.\n\n',
      'Segundo parágrafo.\n\n',
      'Terceiro parágrafo.',
    ])
  })

  test('splits a paragraph above the limit without dropping text', () => {
    const content = 'abcdefghij'
    const chunks = splitMaterialForExtraction(content, 4)
    expect(chunks).toEqual(['abcd', 'efgh', 'ij'])
    expect(chunks.join('')).toBe(content)
  })

  test('assigns stable references to paragraphs without changing their text', () => {
    expect(indexMaterialParagraphs('Primeiro trecho.\n\nSegundo trecho.')).toEqual([
      { id: 'P0001', text: 'Primeiro trecho.', offset: 0 },
      { id: 'P0002', text: 'Segundo trecho.', offset: 18 },
    ])
  })

  test('keeps distinct offsets for repeated source paragraphs', () => {
    const content = 'Same source.\n\nSame source.';
    expect(indexMaterialParagraphs(content).map(({ offset }) => offset)).toEqual([0, 14]);
  })
})

test('relations require both named concepts in the cited paragraph', () => {
  expect(relationNamesInExcerpt('Parser', 'Query Plan', 'The parser turns a query into a syntax tree.')).toBe(false)
  expect(relationNamesInExcerpt('Parser', 'Predicate', 'The parser preserves predicates.')).toBe(true)
  expect(relationNamesInExcerpt('Index Scan', 'Query Planner', 'The planner compares index scans.')).toBe(true)
})
