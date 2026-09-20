import { describe, expect, test } from 'bun:test'
import { indexMaterialParagraphs, splitMaterialForExtraction } from './gemini.gateway'

describe('splitMaterialForExtraction', () => {
  test('preserva todo o conteúdo e privilegia quebras de parágrafo', () => {
    const content = 'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.'
    expect(splitMaterialForExtraction(content, 25)).toEqual([
      'Primeiro parágrafo.\n\n',
      'Segundo parágrafo.\n\n',
      'Terceiro parágrafo.',
    ])
  })

  test('divide um parágrafo maior que o limite sem descartar texto', () => {
    const content = 'abcdefghij'
    const chunks = splitMaterialForExtraction(content, 4)
    expect(chunks).toEqual(['abcd', 'efgh', 'ij'])
    expect(chunks.join('')).toBe(content)
  })

  test('atribui referências estáveis aos parágrafos sem alterar seu texto', () => {
    expect(indexMaterialParagraphs('Primeiro trecho.\n\nSegundo trecho.')).toEqual([
      { id: 'P0001', text: 'Primeiro trecho.' },
      { id: 'P0002', text: 'Segundo trecho.' },
    ])
  })
})
