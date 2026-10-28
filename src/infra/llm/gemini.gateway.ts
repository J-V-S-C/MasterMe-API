import { GeminiStructuredClient } from './gemini-structured.client';
import type { Concept } from '../../application/domain/concept';
import type { MasterMeQuestion } from '../../application/domain/assessment';
import type { Evaluation, IsomorphicProblem, EdgeCaseChallenge } from '../../application/domain/assessment';
import type { PracticeProjectContent, PrioritizedConcept } from '../../application/domain/practice-project';
import type { MaterialOutlineUnit, StudyMaterial, SupportedLocale } from '../../application/domain/material';
import {
  EvaluationSchema,
  GeminiEvaluationResponseSchema,
  ExtractedKnowledgeSchema,
  IsomorphicProblemSchema,
  SinglePassKnowledgeResponseSchema,
  EdgeCaseChallengeSchema,
  PracticeProjectContentSchema,
  LocalizedKnowledgeResponseSchema,
  type ExtractedKnowledge,
  type LocalizedKnowledgeResponse,
} from '../../schemas/llm.schema';
import type { ExtractionProgress, MasterMeLlmGateway } from '../../application/ports/llm.gateway';
import { focusExcerptOnChapter, passesAssessmentQuestionScreen, questionIntroducesUnsupportedTerms, sourceGroundedFallbackQuestion } from '../../application/prompts/assessment-question';
import { derivePrintedChapterUnits } from '../parsers/editorial-structure';
import type { ActivityAssessmentGateway } from '../../application/ports/activity-assessment.gateway';

const asJson = (value: unknown): string => JSON.stringify(value);
const EXTRACTION_CHUNK_SIZE = 12_000;
const MAX_EVIDENCE_SPAN_CHARS = 1_600;
const MAX_EXTRACTION_PROMPT_CHARS = 100_000;
const localeName = (locale: SupportedLocale): string =>
  locale === 'pt-BR' ? 'português do Brasil' : 'English (United States)';
export const indexMaterialParagraphs = (
  content: string,
  maxParagraphSize = MAX_EVIDENCE_SPAN_CHARS,
  editorialBoundaries: number[] = [],
): Array<{ id: string; text: string; offset: number }> => {
  const paragraphs: Array<{ id: string; text: string; offset: number }> = [];
  let start = 0;
  const add = (end: number) => {
    const raw = content.slice(start, end);
    const text = raw.trim();
    if (text) {
      let index = 0;
      while (index < text.length) {
        let end = Math.min(index + maxParagraphSize, text.length);
        if (end < text.length) {
          const minimum = index + Math.floor(maxParagraphSize * 0.6);
          const sentence = text.lastIndexOf('. ', end - 1);
          const line = text.lastIndexOf('\n', end - 1);
          const space = text.lastIndexOf(' ', end - 1);
          end = sentence >= minimum ? sentence + 2 : line >= minimum ? line + 1 : space >= minimum ? space + 1 : end;
        }
        paragraphs.push({
          id: `P${String(paragraphs.length + 1).padStart(4, '0')}`,
          text: text.slice(index, end),
          offset: start + raw.indexOf(text) + index,
        });
        index = end;
      }
    }
  };
  // PDF text often uses one newline per printed line. A chapter heading must
  // still start a new evidence span even when the previous page has no blank line.
  const separators = [
    ...Array.from(content.matchAll(/\n\s*\n+|(?=^#{1,6}\s+\S)|(?=^(?:chapter|cap[ií]tulo)\s+\d{1,3}(?:[.:]|\s)\s*\S)|(?<=[.!?]\s)(?=(?:chapter|cap[ií]tulo)\s+\d{1,3}(?:[.:]|\s)\s*\S)/gim), (match) => ({ index: match.index, length: match[0].length })),
    ...editorialBoundaries.filter((offset) => Number.isInteger(offset) && offset > 0 && offset < content.length).map((index) => ({ index, length: 0 })),
  ].sort((left, right) => left.index - right.index || right.length - left.length);
  for (const separator of separators) {
    if (separator.index < start) continue;
    add(separator.index);
    start = separator.index + separator.length;
  }
  add(content.length);
  return paragraphs;
};

export const batchIndexedParagraphs = <T extends { id: string; text: string }>(
  paragraphs: T[],
  maxChars = MAX_EXTRACTION_PROMPT_CHARS,
): T[][] => {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const paragraph of paragraphs) {
    const length = paragraph.id.length + paragraph.text.length + 4;
    if (current.length && size + length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(paragraph);
    size += length;
  }
  if (current.length) batches.push(current);
  return batches;
};

type IndexedParagraph = ReturnType<typeof indexMaterialParagraphs>[number];
type PlannedBatch = { paragraphs: IndexedParagraph[]; conceptLimit: number; editorialGuide: string; chapterIndex: number | null };

export function planExtractionBatches(material: StudyMaterial, paragraphs: IndexedParagraph[], outline: MaterialOutlineUnit[] = [], maxConcepts = 12): { book: boolean; batches: PlannedBatch[]; chapterLimits: Map<number, number> } {
  const saved = outline.filter((unit) => unit.title?.trim() && unit.provenance !== 'UNSTRUCTURED');
  const reliable = (saved.length >= 2 ? saved : material.sourceType === 'PDF' ? derivePrintedChapterUnits(material.content) : saved).sort((a, b) => a.startOffset - b.startOffset);
  const numbered = reliable.filter((unit) => /^(?:chapter|cap[ií]tulo)\s+\d+/i.test(unit.title!));
  const chapterLevel = [...new Set(reliable.map((unit) => unit.level))].sort((a, b) => a - b)
    .find((level) => reliable.filter((unit) => unit.level === level).length >= 2) ?? Infinity;
  const chapters = numbered.length >= 2 ? numbered : reliable.filter((unit) => unit.level === chapterLevel);
  const book = chapters.length >= 2 && (material.materialKind === 'BOOK' || (
    material.materialKind === undefined &&
    (material.sourceType === 'PDF' || material.sourceType === 'MARKDOWN' && material.content.length > 20_000)
  ));
  if (!book) {
    const batches = batchIndexedParagraphs(paragraphs);
    return { book: false, chapterLimits: new Map(), batches: batches.map((batch) => ({ paragraphs: batch, conceptLimit: batches.length === 1 ? maxConcepts : Math.max(1, Math.ceil(maxConcepts / batches.length)), editorialGuide: '', chapterIndex: null })) };
  }
  const batches: PlannedBatch[] = [];
  const chapterLimits = new Map<number, number>();
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const end = chapters[chapterIndex + 1]?.startOffset ?? material.content.length;
    const chapterParagraphs = paragraphs.filter((paragraph) => paragraph.offset >= chapter.startOffset && paragraph.offset < end);
    if (!chapterParagraphs.length) continue;
    const sections = reliable.filter((unit) => unit.startOffset > chapter.startOffset && unit.startOffset < end);
    const guide = [chapter.title!, ...sections.map((unit) => unit.title!)].slice(0, 40).join('\n');
    const chunked = batchIndexedParagraphs(chapterParagraphs);
    const chapterLimit = Math.min(maxConcepts, 8, Math.max(1, sections.length || Math.ceil(chapterParagraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) / 6_000)));
    chapterLimits.set(chapterIndex, chapterLimit);
    for (const batch of chunked) batches.push({ paragraphs: batch, conceptLimit: Math.max(1, Math.ceil(chapterLimit / chunked.length)), editorialGuide: guide, chapterIndex });
  }
  return { book: true, batches, chapterLimits };
}

export const splitMaterialForExtraction = (
  content: string,
  maxSize = EXTRACTION_CHUNK_SIZE,
): string[] => {
  const paragraphs =
    content.match(/[\s\S]*?(?:\n\s*\n|$)/g)?.filter(Boolean) ?? [];
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current);
    current = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxSize) {
      push();
      for (let offset = 0; offset < paragraph.length; offset += maxSize)
        chunks.push(paragraph.slice(offset, offset + maxSize));
    } else if (current.length + paragraph.length > maxSize) {
      push();
      current = paragraph;
    } else current += paragraph;
  }
  push();
  return chunks;
};

const sourceWords = (value: string): string[] => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .match(/[a-z0-9]+/g) ?? [];

const termStem = (word: string): string => {
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (/(?:x|ch|sh|ss)es$/u.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return word;
};

export const relationNamesInExcerpt = (fromName: string, toName: string, excerpt: string): boolean => {
  const source = new Set(sourceWords(excerpt).map(termStem));
  const namePresent = (name: string) => {
    const term = sourceWords(name).filter((word) => word.length >= 4).at(-1);
    return Boolean(term && source.has(termStem(term)));
  };
  return namePresent(fromName) && namePresent(toName);
};

export class GeminiMasterMeGateway
  implements MasterMeLlmGateway, ActivityAssessmentGateway
{
  public constructor(
    private readonly client: GeminiStructuredClient,
    private readonly maxConcepts = 12,
  ) {}

  public async extractKnowledge(
    material: StudyMaterial,
    onProgress?: (progress: ExtractionProgress) => Promise<void>,
    outline: MaterialOutlineUnit[] = [],
  ): Promise<ExtractedKnowledge> {
    const paragraphs = indexMaterialParagraphs(material.content, MAX_EVIDENCE_SPAN_CHARS, outline.map((unit) => unit.startOffset));
    const plan = planExtractionBatches(material, paragraphs, outline, this.maxConcepts);
    const batches = plan.batches;
    await onProgress?.({
      stage: 'PREPARING',
      totalChunks: batches.length,
      completedChunks: 0,
    });
    const responses: Array<{ response: Awaited<ReturnType<GeminiMasterMeGateway['extractMaterial']>>; ids: Set<string>; chapterIndex: number | null }> = [];
    for (const [index, batch] of batches.entries()) {
      await onProgress?.({
        stage: 'EXTRACTING',
        totalChunks: batches.length,
        completedChunks: index,
      });
      responses.push({ response: await this.extractMaterial(
        batch.paragraphs,
        material.locale,
        batch.conceptLimit,
        plan.book || batches.length > 1,
        batch.editorialGuide,
      ), ids: new Set(batch.paragraphs.map((paragraph) => paragraph.id)), chapterIndex: batch.chapterIndex });
    }
    await onProgress?.({
      stage: 'REDUCING',
      totalChunks: batches.length,
      completedChunks: batches.length,
    });

    const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    const candidates = responses.flatMap(({ response, ids, chapterIndex }) => response.fragments.filter((fragment) => ids.has(fragment.sourceParagraphId.trim().toUpperCase())).map((fragment) => ({ ...fragment, chapterIndex })));
    const validCandidates = this.uniqueFragments(candidates)
      .flatMap((fragment) => {
        const source = paragraphById.get(
          fragment.sourceParagraphId.trim().toUpperCase(),
        );
        return source ? [{ ...fragment, sourceExcerpt: source.text, sourceOffset: source.offset }] : [];
      })
    const chapterCounts = new Map<number, number>();
    const selected = plan.book
      ? validCandidates.filter((fragment) => {
          const index = fragment.chapterIndex;
          if (index === null) return false;
          const count = chapterCounts.get(index) ?? 0;
          if (count >= (plan.chapterLimits.get(index) ?? 0)) return false;
          chapterCounts.set(index, count + 1);
          return true;
        })
      : validCandidates.length <= this.maxConcepts
        ? validCandidates
        : Array.from({ length: this.maxConcepts }, (_, index) =>
            validCandidates[Math.floor(index * validCandidates.length / this.maxConcepts)]!);
    const fragments = selected
      .map(
        ({
          sourceParagraphId: _sourceParagraphId,
          questionText,
          targetPremise,
          expectedReasoningSteps,
          learningObjective,
          requiredIdeas,
          commonMisconceptions,
          chapterIndex: _chapterIndex,
          ...fragment
        }) => ({
          ...fragment,
          edgeCaseQuestion: passesAssessmentQuestionScreen(
            fragment.edgeCaseQuestion,
          )
            ? fragment.edgeCaseQuestion
            : undefined,
          studyQuestion: passesAssessmentQuestionScreen(questionText, requiredIdeas) &&
            !questionIntroducesUnsupportedTerms(questionText, focusExcerptOnChapter(fragment.sourceExcerpt, fragment.name).text) &&
            !questionIntroducesUnsupportedTerms(questionText, `${fragment.name.replace(/([a-z])([A-Z])/g, '$1 $2')} ${fragment.description} ${fragment.fundamentalPremises.join(' ')}`)
            ? {
                text: questionText,
                targetPremise,
                expectedReasoningSteps,
                learningObjective,
                requiredIdeas,
                commonMisconceptions,
              }
            : sourceGroundedFallbackQuestion(fragment.name, material.locale),
          prerequisiteNames: fragment.prerequisiteNames ?? [],
        }),
      );
    const availableNames = new Set(
      fragments.map((fragment) => fragment.name.trim().toLocaleLowerCase()),
    );
    const seenRelations = new Set<string>();
    const relations = responses.flatMap(({ response, ids }) => response.relations.filter((relation) => ids.has(relation.sourceParagraphId.trim().toUpperCase()))).flatMap((relation) => {
      const fromName = relation.fromName.trim().toLocaleLowerCase();
      const toName = relation.toName.trim().toLocaleLowerCase();
      const source = paragraphById.get(
        relation.sourceParagraphId.trim().toUpperCase(),
      );
      const key = `${fromName}:${toName}:${relation.relationType}`;
      if (
        !availableNames.has(fromName) ||
        !availableNames.has(toName) ||
        fromName === toName ||
        !source ||
        !relationNamesInExcerpt(relation.fromName, relation.toName, source.text) ||
        seenRelations.has(key)
      )
        return [];
      seenRelations.add(key);
      return [
        {
          fromName: relation.fromName,
          toName: relation.toName,
          relationType: relation.relationType,
          statement: relation.statement,
          justification: relation.justification,
          sourceExcerpt: source.text,
          sourceOffset: source.offset,
        },
      ];
    });
    return ExtractedKnowledgeSchema.parse({
      fragments: fragments.map((fragment) => ({
        ...fragment,
        prerequisiteNames: fragment.prerequisiteNames.filter((name) => {
          const normalized = name.trim().toLocaleLowerCase();
          return (
            normalized !== fragment.name.trim().toLocaleLowerCase() &&
            availableNames.has(normalized)
          );
        }),
      })),
      relations,
    });
  }

  private extractMaterial(
    paragraphs: Array<{ id: string; text: string }>,
    locale: SupportedLocale,
    conceptLimit: number,
    isPartOfBook: boolean,
    editorialGuide = '',
  ) {
    const indexedMaterial = paragraphs
      .map(({ id, text }) => `[${id}]\n${text}`)
      .join('\n\n');
    return this.client.generateStructured(
      SinglePassKnowledgeResponseSchema,
      `Você analisa ${isPartOfBook ? 'uma parte de um material técnico maior' : 'um material técnico'} de engenharia de software. Produza TODOS os campos gerados em ${localeName(locale)}, mesmo quando o material estiver em outro idioma; preserve termos técnicos no idioma original entre parênteses quando isso ajudar. Extraia no máximo ${conceptLimit} conceitos centrais que estejam EXPLICITAMENTE nesta parte. ${editorialGuide ? 'Use o sumário editorial abaixo para distribuir conceitos pelas seções substantivas deste capítulo, mas nunca trate títulos isolados como evidência: descrições, perguntas e critérios devem vir do conteúdo citado por sourceParagraphId. Não invente um conceito só para preencher um título.' : ''} Priorize os conceitos que desbloqueiam a compreensão dos demais e descarte detalhes repetidos. Para cada conceito, retorne nome curto e único, descrição didática de duas ou três frases curtas (até 500 caracteres), kind AXIOM/NODE/EDGE, sourceParagraphId com exatamente um dos IDs fornecidos, premissas fundamentais, casos de borda e prerequisiteNames contendo somente nomes de outros conceitos retornados. Escreva a descrição como um professor paciente: explique em linguagem simples o que o conceito significa, como funciona e os termos necessários para entender a pergunta; use um exemplo concreto somente se estiver sustentado pelo trecho. Evite definições circulares, jargão sem explicação e fatos de fora do trecho. Retorne uma questionText que teste uma única ideia importante por mecanismo, causalidade ou aplicação e que possa ser respondida integralmente com o trecho de origem e a descrição. Toda entidade, termo de comparação e condição exigida na pergunta ou em requiredIdeas deve estar explicitamente explicada nesse trecho. Se o trecho apenas apresentar um estilo ou enumerar componentes, pergunte somente sobre essas afirmações; não invente o funcionamento de um registro, despacho dinâmico, exemplo de domínio ou benefício que apareça em outra parte do material. Se o trecho não explicar os dois lados de uma comparação (por exemplo, características arquiteturais e requisitos funcionais), não faça essa comparação; pergunte sobre o conceito sustentado. Não atribua benefícios, riscos ou condições ausentes desse trecho. Nunca pergunte apenas definição, tradução ou valor de retorno. Retorne targetPremise, expectedReasoningSteps com 2 a 4 passos, learningObjective em uma frase, requiredIdeas com 2 a 4 critérios essenciais e commonMisconceptions. edgeCaseQuestion deve exigir raciocínio sobre uma condição-limite, não mera lembrança. Em relations, inclua apenas ligações cuja proposição e justificativa sejam sustentadas diretamente por um único sourceParagraphId do material indexado que mencione os dois conceitos; use fromName e toName exatamente como em fragments, relationType REQUIRES/ENABLES/CONTRASTS/APPLIES_TO/PART_OF, statement e justification. Se o texto não sustentar uma ligação, retorne relations vazio. Não invente IDs, conteúdo ou relações.${editorialGuide ? `\n\nSUMÁRIO EDITORIAL (guia, não evidência):\n${editorialGuide}` : ''}\n\nMATERIAL INDEXADO:\n${indexedMaterial}`,
      { operation: 'EXTRACTION', maxOutputTokens: 6000 },
    );
  }

  public localizeKnowledge(
    concepts: Concept[],
    locale: SupportedLocale,
  ): Promise<LocalizedKnowledgeResponse> {
    const content = concepts.map((concept) => ({
      id: concept.id,
      name: concept.name,
      description: concept.description,
      fundamentalPremises: concept.fundamentalPremises,
      edgeCases: concept.edgeCases,
      edgeCaseQuestion: concept.edgeCaseQuestion ?? '',
      studyQuestion: concept.studyQuestion ?? null,
    }));
    return this.client.generateStructured(
      LocalizedKnowledgeResponseSchema,
      `Localize os campos gerados abaixo para ${localeName(locale)}. Preserve exatamente cada id, a quantidade de itens e o significado técnico. Não traduza IDs e não acrescente fatos. Mantenha nomes técnicos conhecidos no idioma original entre parênteses quando útil. As perguntas devem exigir mecanismo ou aplicação, nunca apenas definição ou valor de retorno. Retorne todos os campos do schema.\nCONCEITOS: ${asJson(content)}`,
      { operation: 'LOCALIZATION', maxOutputTokens: 5000 },
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
      `Responda em ${localeName(concept.generatedLocale === 'en-US' ? 'en-US' : 'pt-BR')}. Avalie semanticamente a explicação usando somente a evidência fornecida e aceite linguagem informal equivalente. PASSED: as ideias essenciais e o mecanismo estão presentes. INCOMPLETE: a direção está correta, mas uma ideia essencial falta ou está ambígua. LOGICAL_BREAK: há contradição explícita, causalidade invertida ou mecanismo incorreto; nunca use LOGICAL_BREAK por mera omissão. A rubrica para ${concept.kind} é: ${this.evaluationRubric(concept.kind)} Retorne feedback curto, strength com o principal acerto, gap vazio quando aprovado ou uma única lacuna, nextAction acionável sem entregar o gabarito, e evidenceQuote copiado literalmente da RESPOSTA que sustenta o diagnóstico.\nCONCEITO: ${concept.name}\nTIPO: ${concept.kind}\nOBJETIVO: ${question.learningObjective ?? question.targetPremise}\nIDEIAS ESSENCIAIS: ${asJson(question.requiredIdeas ?? question.expectedReasoningSteps)}\nERROS COMUNS: ${asJson(question.commonMisconceptions ?? [])}\nEVIDÊNCIA: ${focusExcerptOnChapter(concept.sourceExcerpt, concept.name).text}\nPERGUNTA: ${question.text}\nRESPOSTA: ${answer}`,
      { operation: 'INITIAL_EVALUATION', maxOutputTokens: 400 },
    );
    return EvaluationSchema.parse({
      ...response,
      evidenceQuote: this.quoteFromAnswer(answer, response.evidenceQuote),
      logicalBreak: response.logicalBreak.trim() || null,
      gap: response.gap.trim() || null,
    });
  }

  public async evaluateEdgeCaseAnswer(
    concept: Concept,
    stressTest: EdgeCaseChallenge,
    answer: string,
  ): Promise<Evaluation> {
    const response = await this.client.generateStructured(
      GeminiEvaluationResponseSchema,
      `Responda em ${localeName(concept.generatedLocale === 'en-US' ? 'en-US' : 'pt-BR')}. Avalie se a réplica responde ao caso-limite usando somente a evidência e as premissas. PASSED exige raciocínio causal coerente; INCOMPLETE indica direção correta com uma lacuna; LOGICAL_BREAK exige contradição ou mecanismo incorreto. Não use LOGICAL_BREAK por mera omissão. Retorne feedback curto, strength, gap, nextAction sem fornecer gabarito, e evidenceQuote copiado literalmente da RÉPLICA. A rubrica para ${concept.kind} é: ${this.evaluationRubric(concept.kind)}\nCONCEITO: ${concept.name}\nTIPO: ${concept.kind}\nPREMISSAS: ${asJson(concept.fundamentalPremises)}\nEVIDÊNCIA: ${concept.sourceExcerpt}\nCASO-LIMITE: ${stressTest.scenario}\nPERGUNTA: ${stressTest.question}\nRÉPLICA: ${answer}`,
      { operation: 'EDGE_CASE_EVALUATION', maxOutputTokens: 400 },
    );
    return EvaluationSchema.parse({
      ...response,
      evidenceQuote: this.quoteFromAnswer(answer, response.evidenceQuote),
      logicalBreak: response.logicalBreak.trim() || null,
      gap: response.gap.trim() || null,
    });
  }

  public generateEdgeCaseChallenge(
    concept: Concept,
  ): Promise<EdgeCaseChallenge> {
    return this.client.generateStructured(
      EdgeCaseChallengeSchema,
      `Responda em ${localeName(concept.generatedLocale === 'en-US' ? 'en-US' : 'pt-BR')}. Crie um teste de caso-limite específico usando somente o conceito e sua evidência. A pergunta deve exigir aplicação, comparação ou explicação causal; não aceite definição, tradução, resposta de uma palavra ou simples valor de retorno.\nCONCEITO: ${concept.name}\nPREMISSAS: ${asJson(concept.fundamentalPremises)}\nCASOS DE BORDA: ${asJson(concept.edgeCases)}\nEVIDÊNCIA: ${concept.sourceExcerpt}`,
      { operation: 'EDGE_CASE_GENERATION', maxOutputTokens: 350 },
    );
  }

  public generatePracticeProject(
    material: StudyMaterial,
    concepts: Concept[],
    priorities: PrioritizedConcept[],
    preferences: { difficulty?: 'FOUNDATION' | 'INTERMEDIATE' | 'ADVANCED'; size?: 'SMALL' | 'MEDIUM'; observedGaps?: string[]; chapterTitles?: string[] } = {},
  ): Promise<PracticeProjectContent> {
    const context = concepts.map((concept) => ({
      name: concept.name,
      description: concept.description,
      premises: concept.fundamentalPremises,
      edgeCases: concept.edgeCases,
      sourceExcerpt: concept.sourceExcerpt,
      reason: priorities.find((item) => item.conceptId === concept.id)?.reason,
    }));
    return this.client.generateStructured(
      PracticeProjectContentSchema,
      `Responda em ${localeName(material.locale)}. Gere um Projeto de prática executável, autônomo e objetivo para aplicar os conceitos priorizados. Use contexto com no máximo duas frases, objetivo em uma frase, até quatro entregáveis, até quatro restrições e um primeiro passo concreto. Não peça envio de solução e não prometa avaliação. Use somente tecnologias sustentadas pelo material ou restrições genéricas. Ajuste a dificuldade e o tamanho pedidos; as lacunas observadas indicam onde o projeto deve exigir raciocínio, mas não prove que o estudante domina ou errou um tema. Títulos de capítulo são contexto, não evidência.\nDIFICULDADE: ${preferences.difficulty ?? 'INTERMEDIATE'}\nTAMANHO: ${preferences.size ?? 'SMALL'}\nLACUNAS OBSERVADAS: ${asJson(preferences.observedGaps ?? [])}\nCAPÍTULOS RELACIONADOS: ${asJson(preferences.chapterTitles ?? [])}\nMATERIAL: ${material.title}\nCONCEITOS PRIORIZADOS EM ORDEM: ${asJson(context)}`,
      { operation: 'PRACTICE_PROJECT', maxOutputTokens: 700 },
    );
  }

  public generateIsomorphicProblem(
    concepts: Concept[],
    observedFailures: string[],
  ): Promise<IsomorphicProblem> {
    const namesById = new Map(
      concepts.map((concept) => [concept.id, concept.name]),
    );
    const compactConcepts = concepts.map((concept) => ({
      name: concept.name,
      kind: concept.kind,
      premises: concept.fundamentalPremises,
      prerequisites: concept.prerequisiteIds.flatMap(
        (id) => namesById.get(id) ?? [],
      ),
      next: concept.nextIds.flatMap((id) => namesById.get(id) ?? []),
    }));
    return this.client.generateStructured(
      IsomorphicProblemSchema,
      `Gere um problema inédito de arquitetura de software que preserve as restrições lógicas dos conceitos abaixo, mas troque completamente o domínio de negócio. Dê prioridade às falhas observadas. Não peça código; peça uma explicação arquitetural clara e justificada.\nCONCEITOS: ${asJson(compactConcepts)}\nFALHAS OBSERVADAS: ${asJson(observedFailures)}`,
      { operation: 'ISOMORPHIC_PROBLEM', maxOutputTokens: 800 },
    );
  }

  private evaluationRubric(kind: Concept['kind']): string {
    if (kind === 'AXIOM')
      return 'verifique necessidade da premissa, mecanismo, consequência da remoção e ausência de raciocínio circular.';
    if (kind === 'NODE')
      return 'verifique cadeia causal, transformação realizada, dependências e efeito produzido.';
    return 'verifique origem e destino da relação, causalidade e efeito de inverter, enfraquecer ou remover a ligação.';
  }

  private quoteFromAnswer(answer: string, quote: string): string | null {
    const trimmed = quote.trim();
    return trimmed.length > 0 && answer.includes(trimmed) ? trimmed : null;
  }

  public async evaluateActivity(
    input: Parameters<ActivityAssessmentGateway['evaluateActivity']>[0],
  ): Promise<Evaluation> {
    const response = await this.client.generateStructured(
      GeminiEvaluationResponseSchema,
      `Responda em ${localeName(input.locale)}. Avalie somente a resposta do estudante à atividade ${input.activityType}, usando o trecho fornecido. PASSED exige os critérios essenciais da atividade; INCOMPLETE indica omissão relevante; LOGICAL_BREAK exige contradição explícita, nunca mera omissão. Aceite formulações equivalentes e não invente fatos além do trecho. Devolva feedback curto, um acerto, uma lacuna quando houver, um próximo passo sem gabarito, e evidenceQuote copiado literalmente da RESPOSTA.\nCONCEITO: ${input.conceptName}\nEVIDÊNCIA: ${input.sourceExcerpt}\nCRITÉRIOS: ${asJson(input.criteria)}\nPERGUNTA: ${input.prompt}\nRESPOSTA: ${input.answer}`,
      { operation: 'INITIAL_EVALUATION', maxOutputTokens: 400 },
    );
    return EvaluationSchema.parse({
      ...response,
      evidenceQuote: this.quoteFromAnswer(input.answer, response.evidenceQuote),
      logicalBreak: response.logicalBreak.trim() || null,
      gap: response.gap.trim() || null,
    });
  }
}
