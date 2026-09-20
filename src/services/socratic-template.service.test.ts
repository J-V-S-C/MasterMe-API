import { describe, expect, test } from 'bun:test'
import type { Concept } from '../domain/socratic'
import { SocraticTemplateService } from './socratic-template.service'

const makeConcept = (kind: Concept['kind'], id: string, name: string): Concept => ({
  id,
  materialId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name,
  description: `Descrição de ${name}`,
  kind,
  sourceExcerpt: `Evidência de ${name}`,
  fundamentalPremises: [`Premissa de ${name}`],
  edgeCases: [`Caso-limite de ${name}`],
  prerequisiteIds: [],
  nextIds: [],
})

describe('SocraticTemplateService', () => {
  const templates = new SocraticTemplateService()
  const axiom = makeConcept('AXIOM', '11111111-1111-4111-8111-111111111111', 'Axioma base')
  const node = { ...makeConcept('NODE', '22222222-2222-4222-8222-222222222222', 'Nó operacional'), prerequisiteIds: [axiom.id] }
  const edge = { ...makeConcept('EDGE', '33333333-3333-4333-8333-333333333333', 'Relação causal'), prerequisiteIds: [node.id] }
  axiom.nextIds = [node.id]
  node.nextIds = [edge.id]
  const concepts = [axiom, node, edge]

  test.each([
    [axiom, 'necessária'],
    [node, 'cadeia causal'],
    [edge, 'invertida'],
  ] as const)('gera pergunta fundamentada para %s', (concept, expectedText) => {
    const question = templates.generateQuestion(concept, concepts, 0)
    expect(question.text).toContain(concept.name)
    expect(question.text).toContain(expectedText)
    expect(question.targetPremise).toBe(concept.fundamentalPremises[0]!)
    expect(question.expectedReasoningSteps.length).toBeGreaterThanOrEqual(3)
  })

  test('gera stress test a partir do caso-limite persistido', () => {
    const stress = templates.generateStressTest(edge, 'session-id')
    expect(stress.scenario).toBe(edge.edgeCases[0]!)
    expect(stress.edgeCaseTested).toBe(edge.edgeCases[0]!)
    expect(stress.question).toContain(edge.name)
  })
})
