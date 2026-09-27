import { describe, expect, test } from 'bun:test'
import { InMemoryMasterMeRepository } from './masterme.repository'

describe('ownership de materiais', () => {
  test('não lista materiais pertencentes a outra conta', async () => {
    const repository = new InMemoryMasterMeRepository()
    const material = { id: '11111111-1111-4111-8111-111111111111', title: 'Privado', content: 'Conteúdo privado suficiente.', createdAt: new Date().toISOString() }
    await repository.saveMaterial(material, '22222222-2222-4222-8222-222222222222')
    expect(await repository.findAllMaterials('22222222-2222-4222-8222-222222222222')).toEqual([material])
    expect(await repository.findAllMaterials('33333333-3333-4333-8333-333333333333')).toEqual([])
  })
})
