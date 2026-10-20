import { describe, expect, test } from 'bun:test'
import { batchIndexedParagraphs, GeminiMasterMeGateway, indexMaterialParagraphs, relationNamesInExcerpt, splitMaterialForExtraction } from './gemini.gateway'
import type { GeminiStructuredClient } from './gemini-structured.client'

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

  test('splits long paragraphs while preserving offsets and bounded batches', () => {
    const paragraphs = indexMaterialParagraphs('x'.repeat(25), 10)
    expect(paragraphs.map(({ text, offset }) => [text, offset])).toEqual([
      ['x'.repeat(10), 0], ['x'.repeat(10), 10], ['x'.repeat(5), 20],
    ])
    expect(batchIndexedParagraphs(paragraphs, 25).map((batch) => batch.map(({ id }) => id))).toEqual([
      ['P0001'], ['P0002'], ['P0003'],
    ])
  })
})

test('extracts book batches separately and preserves cited offsets', async () => {
  const prompts: string[] = []
  const client = { generateStructured: async (_schema: unknown, prompt: string) => {
    prompts.push(prompt)
    const id = prompt.match(/\[(P\d+)\]/)?.[1]
    return { fragments: [{
      name: `Concept ${prompts.length}`, description: 'A concept from this passage.', kind: 'NODE',
      sourceParagraphId: id, fundamentalPremises: ['A premise'], edgeCases: ['A case'],
      edgeCaseQuestion: 'How does this mechanism behave at the boundary?',
      questionText: 'How does this mechanism work in practice?', targetPremise: 'A premise',
      expectedReasoningSteps: ['First', 'Second'], learningObjective: 'Explain the mechanism.',
      requiredIdeas: ['First', 'Second'], commonMisconceptions: [], prerequisiteNames: [],
    }], relations: [] }
  } } as unknown as GeminiStructuredClient
  const progress: Array<{ stage: string; totalChunks: number; completedChunks: number }> = []
  const material = { id: 'book', title: 'Book', locale: 'en-US' as const,
    content: 'First passage.\n\n' + 'x'.repeat(110_000), createdAt: new Date().toISOString() }
  const result = await new GeminiMasterMeGateway(client).extractKnowledge(material, async (event) => {
    progress.push(event)
  })
  expect(prompts.length).toBe(2)
  expect(progress.at(-1)).toEqual({ stage: 'REDUCING', totalChunks: 2, completedChunks: 2 })
  expect(result.fragments.length).toBe(2)
  expect(result.fragments[0]?.sourceExcerpt).toBe('First passage.')
  expect(result.fragments[1]?.sourceExcerpt).toBe('x'.repeat(12_000))
  expect(material.content.includes(result.fragments[1]!.sourceExcerpt)).toBe(true)
})

test('relations require both named concepts in the cited paragraph', () => {
  expect(relationNamesInExcerpt('Parser', 'Query Plan', 'The parser turns a query into a syntax tree.')).toBe(false)
  expect(relationNamesInExcerpt('Parser', 'Predicate', 'The parser preserves predicates.')).toBe(true)
  expect(relationNamesInExcerpt('Index Scan', 'Query Planner', 'The planner compares index scans.')).toBe(true)
})
