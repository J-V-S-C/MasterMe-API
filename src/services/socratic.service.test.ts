import { describe, expect, test } from 'bun:test'
import type {
  Concept,
  Evaluation,
  IsomorphicProblem,
  SocraticQuestion,
  StressTest,
  StudyMaterial,
} from '../domain/socratic'
import { InMemorySocraticRepository } from '../repositories/socratic.repository'
import type { ExtractedKnowledge } from '../schemas/llm.schema'
import type { SocraticLlmGateway } from './llm.gateway'
import { SocraticService } from './socratic.service'

const approvedEvaluation: Evaluation = {
  status: 'PASSED',
  missingPremises: [],
  logicalBreak: null,
  feedback: 'A explicação está consistente.',
}

class FakeSocraticLlm implements SocraticLlmGateway {
  public initialEvaluations = 0
  public stressEvaluations = 0
  public isomorphicProblems = 0
  public failInitialEvaluation = false
  public async extractKnowledge(_material: StudyMaterial): Promise<ExtractedKnowledge> {
    return {
      fragments: [
        {
          name: 'Inversão de dependência',
          description: 'Módulos de alto nível dependem de abstrações.',
          kind: 'AXIOM',
          sourceExcerpt: 'Módulos de alto nível devem depender de abstrações.',
          fundamentalPremises: ['Abstrações reduzem o acoplamento entre detalhes e regras.'],
          edgeCases: ['Uma abstração sem comportamento útil apenas aumenta complexidade.'],
          studyQuestion: {
            text: 'Por que abstrações reduzem o acoplamento entre regras e detalhes?',
            targetPremise: 'Abstrações reduzem o acoplamento entre detalhes e regras.',
            expectedReasoningSteps: ['Distinguir regra e detalhe', 'Explicar a variação da implementação'],
          },
          prerequisiteNames: [],
        },
        {
          name: 'Injeção de dependência',
          description: 'Dependências são fornecidas externamente.',
          kind: 'NODE',
          sourceExcerpt: 'A injeção de dependência fornece colaboradores de fora.',
          fundamentalPremises: ['O objeto consumidor não deve construir o detalhe concreto.'],
          edgeCases: ['Injetar todas as dependências sem critério cria construtores confusos.'],
          studyQuestion: {
            text: 'Como a injeção de dependência evita que o consumidor construa um detalhe concreto?',
            targetPremise: 'O objeto consumidor não deve construir o detalhe concreto.',
            expectedReasoningSteps: ['Identificar o consumidor', 'Explicar o fornecimento externo'],
          },
          prerequisiteNames: ['Inversão de dependência'],
        },
      ],
    }
  }

  public async generateQuestion(_concept: Concept): Promise<SocraticQuestion> {
    return {
      text: 'Como a abstração reduz acoplamento neste cenário?',
      targetPremise: 'Abstrações separam regras de detalhes.',
      expectedReasoningSteps: ['Identificar regra', 'Separar detalhe'],
    }
  }

  public async evaluateAnswer(_concept: Concept, _question: SocraticQuestion, _answer: string): Promise<Evaluation> {
    this.initialEvaluations++
    if (this.failInitialEvaluation) throw new Error('Gemini indisponível')
    return approvedEvaluation
  }

  public async generateStressTest(_concept: Concept, _answer: string): Promise<StressTest> {
    return {
      scenario: 'A interface possui um único consumidor e nenhuma variação prevista.',
      edgeCaseTested: 'Abstração sem comportamento útil.',
      question: 'Como evitar uma abstração prematura?',
    }
  }

  public async evaluateStressReply(_concept: Concept, _stressTest: StressTest, _answer: string): Promise<Evaluation> {
    this.stressEvaluations++
    return approvedEvaluation
  }

  public async generateIsomorphicProblem(_concepts: Concept[], _observedFailures: string[]): Promise<IsomorphicProblem> {
    this.isomorphicProblems++
    return {
      title: 'Sistema de entregas',
      scenario: 'Projete a separação entre a regra de cálculo e integrações externas.',
      constraints: ['Não acople a regra ao provedor de entrega.'],
      responseInstruction: 'Explique a arquitetura em texto.',
    }
  }
}

const createService = (): { service: SocraticService; llm: FakeSocraticLlm } => {
  const llm = new FakeSocraticLlm()
  return { service: new SocraticService(new InMemorySocraticRepository(), llm), llm }
}

describe('SocraticService', () => {
  test('permite estudar conceitos mesmo antes de validar os pré-requisitos', async () => {
    const { service } = createService()
    const material = await service.createMaterial({
      title: 'Dependências',
      content:
        'Módulos de alto nível devem depender de abstrações. A injeção de dependência fornece colaboradores de fora.',
    })
    const concepts = await service.extractConcepts(material.id)
    const dependentConcept = concepts.find((concept) => concept.name === 'Injeção de dependência')
    if (!dependentConcept) throw new Error('Conceito dependente ausente no teste.')

    await expect(service.startSession(dependentConcept.id)).resolves.toMatchObject({ conceptId: dependentConcept.id })
  })

  test('expõe uma pergunta específica para cada nó antes de iniciar uma sessão', async () => {
    const { service } = createService()
    const material = await service.createMaterial({
      title: 'Dependências',
      content: 'Módulos de alto nível devem depender de abstrações. A injeção de dependência fornece colaboradores de fora.',
    })
    await service.extractConcepts(material.id)

    const map = await service.getKnowledgeMap(material.id)
    const injection = map.find((node) => node.concept.name === 'Injeção de dependência')
    expect(injection?.question?.text).toBe('Como a injeção de dependência evita que o consumidor construa um detalhe concreto?')
  })

  test('valida o conceito somente após resposta inicial e réplica ao stress test', async () => {
    const { service, llm } = createService()
    const material = await service.createMaterial({
      title: 'Dependências',
      content:
        'Módulos de alto nível devem depender de abstrações. A injeção de dependência fornece colaboradores de fora.',
    })
    const concepts = await service.extractConcepts(material.id)
    const axiom = concepts.find((concept) => concept.kind === 'AXIOM')
    if (!axiom) throw new Error('Axioma ausente no teste.')

    const session = await service.startSession(axiom.id)
    expect(llm.initialEvaluations + llm.stressEvaluations).toBe(0)
    expect(session.question.text).toContain('Inversão de dependência')
    const afterInitialAnswer = await service.evaluateInitialAnswer(
      session.id,
      'A regra depende de uma interface para que a implementação possa variar sem mudar o módulo de alto nível.',
    )
    expect(afterInitialAnswer.state).toBe('AWAITING_STRESS_REPLY')
    expect(afterInitialAnswer.stressTest).not.toBeNull()
    expect(afterInitialAnswer.stressTest?.scenario).toBe(axiom.edgeCases[0])
    expect(llm.initialEvaluations).toBe(1)

    const duplicated = await service.evaluateInitialAnswer(
      session.id,
      'A regra depende de uma interface para que a implementação possa variar sem mudar o módulo de alto nível.',
    )
    expect(duplicated).toEqual(afterInitialAnswer)
    expect(llm.initialEvaluations).toBe(1)

    const afterStressReply = await service.evaluateStressReply(
      session.id,
      'Quando não há variação, avalio se a abstração traz um comportamento estável antes de introduzi-la.',
    )
    expect(afterStressReply.state).toBe('VALIDATED')
    expect(afterStressReply.attempts).toHaveLength(2)
    expect(llm.stressEvaluations).toBe(1)
  })

  test('reutiliza problema isomórfico para o mesmo grafo e histórico', async () => {
    const { service, llm } = createService()
    const material = await service.createMaterial({
      title: 'Dependências',
      content: 'Módulos de alto nível devem depender de abstrações. A injeção de dependência fornece colaboradores de fora.',
    })
    await service.extractConcepts(material.id)
    const first = await service.generateIsomorphicProblem(material.id)
    const second = await service.generateIsomorphicProblem(material.id)
    expect(second).toEqual(first)
    expect(llm.isomorphicProblems).toBe(1)
  })

  test('preserva o estado da sessão quando a validação externa falha', async () => {
    const { service, llm } = createService()
    const material = await service.createMaterial({
      title: 'Dependências',
      content: 'Módulos de alto nível devem depender de abstrações. A injeção de dependência fornece colaboradores de fora.',
    })
    const concepts = await service.extractConcepts(material.id)
    const axiom = concepts.find((concept) => concept.kind === 'AXIOM')
    if (!axiom) throw new Error('Axioma ausente no teste.')
    const session = await service.startSession(axiom.id)

    llm.failInitialEvaluation = true
    await expect(service.evaluateInitialAnswer(session.id, 'Resposta temporária.')).rejects.toThrow('Gemini indisponível')

    const persisted = await service.getSession(session.id)
    expect(persisted.state).toBe('QUESTION_READY')
    expect(persisted.attempts).toHaveLength(0)
    expect(persisted.stressTest).toBeNull()
  })
})
