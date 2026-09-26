import type { Concept, MasterMeQuestion } from '../domain/masterme'

const select = <T>(items: T[], seed: number): T | undefined => items.length ? items[seed % items.length] : undefined

const relationNames = (concept: Concept, concepts: Concept[]): { prerequisites: string[]; next: string[] } => {
  const byId = new Map(concepts.map((item) => [item.id, item.name]))
  return {
    prerequisites: concept.prerequisiteIds.flatMap((id) => byId.get(id) ?? []),
    next: concept.nextIds.flatMap((id) => byId.get(id) ?? []),
  }
}

export class MasterMeTemplateService {
  public generateQuestion(concept: Concept, concepts: Concept[], sessionNumber: number): MasterMeQuestion {
    const premise = select(concept.fundamentalPremises, sessionNumber) ?? concept.description
    const relations = relationNames(concept, concepts)
    const prerequisites = relations.prerequisites.length ? relations.prerequisites.join(', ') : 'as premissas apresentadas no trecho'
    const consequences = relations.next.length ? relations.next.join(', ') : 'as consequências descritas no material'

    if (concept.kind === 'AXIOM') return {
      text: `Por que a premissa “${premise}” é necessária para ${concept.name}? Explique o mecanismo e o que deixaria de funcionar se ela fosse removida.`,
      targetPremise: premise,
      expectedReasoningSteps: [
        `Explicar o significado causal de “${premise}”.`,
        'Relacionar a premissa à evidência selecionada do material.',
        `Mostrar uma consequência concreta sobre ${consequences}.`,
      ],
    }

    if (concept.kind === 'NODE') return {
      text: `Como ${concept.name} funciona a partir de ${prerequisites}? Descreva a cadeia causal até ${consequences}, usando a premissa “${premise}”.`,
      targetPremise: premise,
      expectedReasoningSteps: [
        `Partir de ${prerequisites}.`,
        `Explicar o mecanismo de ${concept.name}.`,
        `Conectar o mecanismo a ${consequences}.`,
      ],
    }

    return {
      text: `Por que a relação representada por ${concept.name} conecta ${prerequisites} a ${consequences}? Explique o que mudaria se essa relação fosse invertida, enfraquecida ou removida.`,
      targetPremise: premise,
      expectedReasoningSteps: [
        `Identificar a origem da relação em ${prerequisites}.`,
        `Explicar a ligação causal sustentada por “${premise}”.`,
        `Analisar o impacto da alteração sobre ${consequences}.`,
      ],
    }
  }

}
