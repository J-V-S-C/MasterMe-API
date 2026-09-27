import { GeminiStructuredClient } from '../config/llm';
import type {
  Concept,
  Evaluation,
  IsomorphicProblem,
  MasterMeQuestion,
  EdgeCaseChallenge,
  PracticeProjectContent,
  PrioritizedConcept,
  StudyMaterial,
} from '../domain/masterme';
import {
  EvaluationSchema,
  GeminiEvaluationResponseSchema,
  ExtractedKnowledgeSchema,
  IsomorphicProblemSchema,
  SinglePassKnowledgeResponseSchema,
  EdgeCaseChallengeSchema,
  PracticeProjectContentSchema,
  type ExtractedKnowledge,
} from '../schemas/llm.schema';
import type { ExtractionProgress, MasterMeLlmGateway } from './llm.gateway';

const asJson = (value: unknown): string => JSON.stringify(value);
const EXTRACTION_CHUNK_SIZE = 12_000;

export const indexMaterialParagraphs = (content: string): Array<{ id: string; text: string }> => {
  const raw = content.split(/\n\s*\n+/).map((text) => text.trim()).filter(Boolean)
  const paragraphs = raw.length ? raw : [content.trim()]
  return paragraphs.map((text, index) => ({ id: `P${String(index + 1).padStart(4, '0')}`, text }))
}

export const splitMaterialForExtraction = (
  content: string,
  maxSize = EXTRACTION_CHUNK_SIZE,
): string[] => {
  const paragraphs = content.match(/[\s\S]*?(?:\n\s*\n|$)/g)?.filter(Boolean) ?? [];
  const chunks: string[] = [];
  let current = '';
  const push = () => { if (current.trim()) chunks.push(current); current = ''; };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxSize) {
      push();
      for (let offset = 0; offset < paragraph.length; offset += maxSize)
        chunks.push(paragraph.slice(offset, offset + maxSize));
    } else if (current.length + paragraph.length > maxSize) {
      push(); current = paragraph;
    } else current += paragraph;
  }
  push();
  return chunks;
};

export class GeminiMasterMeGateway implements MasterMeLlmGateway {
  public constructor(
    private readonly client: GeminiStructuredClient,
    private readonly maxConcepts = 12,
  ) {}

  public async extractKnowledge(material: StudyMaterial, onProgress?: (progress: ExtractionProgress) => Promise<void>): Promise<ExtractedKnowledge> {
    await onProgress?.({ stage: 'PREPARING', totalChunks: 1, completedChunks: 0 });
    const paragraphs = indexMaterialParagraphs(material.content)
    // A chamada ao provedor concentra quase todo o tempo da extração. Avise que
    // ela começou antes de aguardá-la; caso contrário a UI fica presa em 1%.
    await onProgress?.({ stage: 'EXTRACTING', totalChunks: 1, completedChunks: 0 });
    const response = await this.extractMaterial(paragraphs);
    await onProgress?.({ stage: 'REDUCING', totalChunks: 1, completedChunks: 1 });

    const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph.text]))
    const fragments = this.uniqueFragments(response.fragments)
      .flatMap((fragment) => {
        const sourceExcerpt = paragraphById.get(fragment.sourceParagraphId.trim().toUpperCase())
        return sourceExcerpt ? [{ ...fragment, sourceExcerpt }] : []
      })
      .slice(0, this.maxConcepts)
      .map(({ sourceParagraphId: _sourceParagraphId, questionText, targetPremise, expectedReasoningSteps, ...fragment }) => ({
        ...fragment,
        studyQuestion: { text: questionText, targetPremise, expectedReasoningSteps },
        prerequisiteNames: fragment.prerequisiteNames ?? [],
      }));
    const availableNames = new Set(fragments.map((fragment) => fragment.name.trim().toLocaleLowerCase()));
    return ExtractedKnowledgeSchema.parse({
      fragments: fragments.map((fragment) => ({
        ...fragment,
        prerequisiteNames: fragment.prerequisiteNames.filter((name) => {
          const normalized = name.trim().toLocaleLowerCase();
          return normalized !== fragment.name.trim().toLocaleLowerCase() && availableNames.has(normalized);
        }),
      })),
    });
  }

  private extractMaterial(paragraphs: Array<{ id: string; text: string }>) {
    const indexedMaterial = paragraphs.map(({ id, text }) => `[${id}]\n${text}`).join('\n\n')
    return this.client.generateStructured(
      SinglePassKnowledgeResponseSchema,
      `Você analisa um material técnico de engenharia de software. Extraia no máximo ${this.maxConcepts} conceitos centrais que estejam EXPLICITAMENTE no material inteiro. Priorize os conceitos que desbloqueiam a compreensão dos demais e descarte detalhes repetidos. Para cada conceito, retorne nome curto e único, descrição concisa, kind AXIOM/NODE/EDGE, sourceParagraphId com exatamente um dos IDs fornecidos, uma premissa fundamental, um caso de borda, edgeCaseQuestion com uma pergunta específica que confronte esse caso de borda e prerequisiteNames contendo somente nomes de outros conceitos retornados. Também retorne questionText: uma pergunta socrática específica e natural sobre ESTE conceito, que faça sentido sem supor que pré-requisitos ou nós relacionados formam uma cadeia causal; targetPremise: a premissa que a resposta deve explicar; e expectedReasoningSteps: 2 a 4 passos de raciocínio esperados. A pergunta deve ser respondível exclusivamente pelo trecho indicado e não pode ser uma pergunta de definição direta. Não copie o parágrafo e não invente IDs, conteúdo ou relações.\n\nMATERIAL INDEXADO:\n${indexedMaterial}`,
      { operation: 'EXTRACTION', maxOutputTokens: 6000 },
    );
  }

  private uniqueFragments<T extends { name: string }>(fragments: T[]): T[] {
    const names = new Set<string>();
    return fragments.filter((fragment) => {
      const name = fragment.name.trim().toLocaleLowerCase();
      if (!name || names.has(name)) return false;
      names.add(name);
      return true;
    });
  }

  public async evaluateAnswer(
    concept: Concept,
    question: MasterMeQuestion,
    answer: string,
  ): Promise<Evaluation> {
    const response = await this.client.generateStructured(
      GeminiEvaluationResponseSchema,
      `Avalie a explicação usando somente a evidência fornecida. A rubrica para ${concept.kind} é: ${this.evaluationRubric(concept.kind)} Jargão sem mecanismo não é suficiente. Se falhar, indique o primeiro salto lógico ou premissa omitida sem entregar a resposta pronta.\nCONCEITO: ${concept.name}\nTIPO: ${concept.kind}\nPREMISSA-ALVO: ${question.targetPremise}\nPASSOS ESPERADOS: ${asJson(question.expectedReasoningSteps)}\nEVIDÊNCIA: ${concept.sourceExcerpt}\nPERGUNTA: ${question.text}\nRESPOSTA: ${answer}`,
      { operation: 'INITIAL_EVALUATION', maxOutputTokens: 400 },
    );
    return EvaluationSchema.parse({ ...response, logicalBreak: response.logicalBreak.trim() || null });
  }

  public async evaluateEdgeCaseAnswer(
    concept: Concept,
    stressTest: EdgeCaseChallenge,
    answer: string,
  ): Promise<Evaluation> {
    const response = await this.client.generateStructured(
      GeminiEvaluationResponseSchema,
      `Avalie se a réplica responde ao caso-limite usando somente a evidência e as premissas fornecidas. A rubrica para ${concept.kind} é: ${this.evaluationRubric(concept.kind)} A resposta só passa se preservar, restringir ou rejeitar a premissa de modo causal e coerente. Não forneça gabarito.\nCONCEITO: ${concept.name}\nTIPO: ${concept.kind}\nPREMISSAS: ${asJson(concept.fundamentalPremises)}\nEVIDÊNCIA: ${concept.sourceExcerpt}\nCASO-LIMITE: ${stressTest.scenario}\nPERGUNTA: ${stressTest.question}\nRÉPLICA: ${answer}`,
      { operation: 'EDGE_CASE_EVALUATION', maxOutputTokens: 400 },
    );
    return EvaluationSchema.parse({ ...response, logicalBreak: response.logicalBreak.trim() || null });
  }

  public generateEdgeCaseChallenge(concept: Concept): Promise<EdgeCaseChallenge> {
    return this.client.generateStructured(
      EdgeCaseChallengeSchema,
      'Crie um teste de caso-limite específico usando somente o conceito e sua evidência. Não use pergunta genérica.\nCONCEITO: ' + concept.name + '\nPREMISSAS: ' + asJson(concept.fundamentalPremises) + '\nCASOS DE BORDA: ' + asJson(concept.edgeCases) + '\nEVIDÊNCIA: ' + concept.sourceExcerpt,
      { operation: 'EDGE_CASE_GENERATION', maxOutputTokens: 350 },
    );
  }

  public generatePracticeProject(material: StudyMaterial, concepts: Concept[], priorities: PrioritizedConcept[]): Promise<PracticeProjectContent> {
    const context = concepts.map((concept) => ({ name: concept.name, description: concept.description, premises: concept.fundamentalPremises, edgeCases: concept.edgeCases, sourceExcerpt: concept.sourceExcerpt, reason: priorities.find((item) => item.conceptId === concept.id)?.reason }));
    return this.client.generateStructured(
      PracticeProjectContentSchema,
      'Gere um Projeto de prática executável e autônomo para aplicar os conceitos priorizados. Não peça ao estudante para enviar uma solução e não prometa avaliação. Use somente tecnologias sustentadas pelo material ou restrições genéricas.\nMATERIAL: ' + material.title + '\nCONCEITOS PRIORIZADOS EM ORDEM: ' + asJson(context),
      { operation: 'PRACTICE_PROJECT', maxOutputTokens: 1000 },
    );
  }

  public generateIsomorphicProblem(
    concepts: Concept[],
    observedFailures: string[],
  ): Promise<IsomorphicProblem> {
    const namesById = new Map(concepts.map((concept) => [concept.id, concept.name]))
    const compactConcepts = concepts.map((concept) => ({
      name: concept.name,
      kind: concept.kind,
      premises: concept.fundamentalPremises,
      prerequisites: concept.prerequisiteIds.flatMap((id) => namesById.get(id) ?? []),
      next: concept.nextIds.flatMap((id) => namesById.get(id) ?? []),
    }))
    return this.client.generateStructured(
      IsomorphicProblemSchema,
      `Gere um problema inédito de arquitetura de software que preserve as restrições lógicas dos conceitos abaixo, mas troque completamente o domínio de negócio. Dê prioridade às falhas observadas. Não peça código; peça uma explicação arquitetural clara e justificada.\nCONCEITOS: ${asJson(compactConcepts)}\nFALHAS OBSERVADAS: ${asJson(observedFailures)}`,
      { operation: 'ISOMORPHIC_PROBLEM', maxOutputTokens: 800 },
    );
  }

  private evaluationRubric(kind: Concept['kind']): string {
    if (kind === 'AXIOM') return 'verifique necessidade da premissa, mecanismo, consequência da remoção e ausência de raciocínio circular.'
    if (kind === 'NODE') return 'verifique cadeia causal, transformação realizada, dependências e efeito produzido.'
    return 'verifique origem e destino da relação, causalidade e efeito de inverter, enfraquecer ou remover a ligação.'
  }
}
