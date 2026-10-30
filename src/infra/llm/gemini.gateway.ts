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
  QuestionBundleSchema,
  type QuestionBundle,
  type ExtractedKnowledge,
  type LocalizedKnowledgeResponse,
} from '../../schemas/llm.schema';
import type { ExtractionProgress, MasterMeLlmGateway } from '../../application/ports/llm.gateway';
import { focusExcerptOnChapter } from '../../application/prompts/assessment-question';
import { derivePrintedChapterUnits } from '../parsers/editorial-structure';
import { MAX_BOOK_CONCEPTS_PER_CHAPTER, MIN_RELIABLE_BOOK_OUTLINE_UNITS } from '../../application/study-limits';
import type { ActivityAssessmentGateway } from '../../application/ports/activity-assessment.gateway';

const asJson = (value: unknown): string => JSON.stringify(value);
const EXTRACTION_CHUNK_SIZE = 12_000;
const MAX_EVIDENCE_SPAN_CHARS = 1_600;
const MAX_EXTRACTION_PROMPT_CHARS = 100_000;
const lowLevelCatalogName = /(?:\bparticipant\b|\bcollaboration\b|^(?:client|subject|invoker|receiver|originator|caretaker|contents|element|handler|subsystem|real\s*subject|concrete\w*|\w+exp))$/i;
const canonicalTopicName = (value: string): string => value
  .replace(/^(?:chapter|cap[ií]tulo)\s+\d+[.:\s-]*/i, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/\b(pattern|padrao)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const selectCentralCandidates = <T extends { name: string }>(candidates: T[], limit: number, chapterTitle?: string): T[] => {
  if (candidates.length <= limit) return candidates;
  const theme = chapterTitle ? canonicalTopicName(chapterTitle) : '';
  const lead = theme ? candidates.find((candidate) => canonicalTopicName(candidate.name) === theme) : undefined;
  if (!lead) return Array.from({ length: limit }, (_, index) => candidates[Math.floor(index * candidates.length / limit)]!);
  const others = candidates.filter((candidate) => candidate !== lead);
  return [lead, ...Array.from({ length: limit - 1 }, (_, index) => others[Math.floor(index * others.length / (limit - 1))]!)];
};
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

export function planExtractionBatches(material: StudyMaterial, paragraphs: IndexedParagraph[], outline: MaterialOutlineUnit[] = [], maxConcepts = 12): { book: boolean; batches: PlannedBatch[]; chapterLimits: Map<number, number>; chapterTitles: Map<number, string> } {
  const saved = outline.filter((unit) => unit.title?.trim() && unit.provenance !== 'UNSTRUCTURED');
  const printed = material.sourceType === 'PDF' || material.materialKind === 'BOOK' ? derivePrintedChapterUnits(material.content) : [];
  const flatOutline = saved.length >= 2 && new Set(saved.map((unit) => unit.level)).size === 1;
  const reliable = (flatOutline && saved.length < MIN_RELIABLE_BOOK_OUTLINE_UNITS && printed.length >= 2 ? printed : saved.length >= 2 ? saved : printed.length >= 2 ? printed : saved).sort((a, b) => a.startOffset - b.startOffset);
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
    return { book: false, chapterLimits: new Map(), chapterTitles: new Map(), batches: batches.map((batch) => ({ paragraphs: batch, conceptLimit: batches.length === 1 ? maxConcepts : Math.max(1, Math.ceil(maxConcepts / batches.length)), editorialGuide: '', chapterIndex: null })) };
  }
  const batches: PlannedBatch[] = [];
  const chapterLimits = new Map<number, number>();
  const chapterTitles = new Map<number, string>();
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const end = chapters[chapterIndex + 1]?.startOffset ?? material.content.length;
    const chapterParagraphs = paragraphs.filter((paragraph) => paragraph.offset >= chapter.startOffset && paragraph.offset < end);
    if (!chapterParagraphs.length) continue;
    const sections = reliable.filter((unit) => unit.startOffset > chapter.startOffset && unit.startOffset < end);
    const guide = [chapter.title!, ...sections.map((unit) => unit.title!)].slice(0, 40).join('\n');
    const chunked = batchIndexedParagraphs(chapterParagraphs);
    const chapterLimit = Math.min(maxConcepts, MAX_BOOK_CONCEPTS_PER_CHAPTER, Math.max(1, Math.ceil(chapterParagraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) / 6_000)));
    chapterLimits.set(chapterIndex, chapterLimit);
    chapterTitles.set(chapterIndex, chapter.title!);
    for (const batch of chunked) batches.push({ paragraphs: batch, conceptLimit: Math.max(1, Math.ceil(chapterLimit / chunked.length)), editorialGuide: guide, chapterIndex });
  }
  return { book: true, batches, chapterLimits, chapterTitles };
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
  public async generateQuestionBundle(concept: Concept, variant = 0): Promise<QuestionBundle> {
    const excerpt = focusExcerptOnChapter(concept.sourceExcerpt, concept.name).text;
    const locale = concept.generatedLocale === 'en-US' ? 'en-US' : 'pt-BR';
    const prompt = [
      `Create six distinct source-grounded study questions in ${localeName(locale)} for the same concept.`,
      'The question text must test the learner, not teach the answer. Do not copy or paraphrase the DESCRIPTION or PREMISES into a question. Do not state the mechanism, steps, conditions, or conclusion that the learner should supply. Put those details only in targetPremise, expectedReasoningSteps, requiredIdeas, and commonMisconceptions.',
      'Explanation: ask the learner to reconstruct how or why the concept works from the passage. Name the topic and the problem or outcome, but leave the causal steps for the learner. A question that says how a pattern uses a particular mechanism to achieve its goal gives away the answer.',
      'Reasoning: ask for an inference or limitation that follows from the passage; do not supply the inference.',
      'Application: give a small concrete situation and ask what the learner would do and why. Do not tell the learner which implementation step ensures the result.',
      'Challenge: test a meaningful edge or failure case. Retention: ask for the key ideas from memory without restating them. Practice: request a focused construction or investigation.',
      'Each question must be specific to the concept, answerable from the cited source, concise, and different from the others. Different wording from the source is welcome when the meaning stays faithful. Never use a generic question template, ask only for a definition, invent details, or require knowledge absent from the source.',
      'The explanation object must include text, targetPremise, expectedReasoningSteps (2-4), learningObjective, requiredIdeas (2-4), and commonMisconceptions.',
      `Question set variation: ${variant}.`,
      `CONCEPT: ${concept.name}`,
      `DESCRIPTION: ${concept.description}`,
      `PREMISES: ${asJson(concept.fundamentalPremises)}`,
      `SOURCE: ${excerpt}`,
    ].join('\n');
    return this.client.generateStructured(
      QuestionBundleSchema,
      prompt,
      { operation: 'QUESTION_SET_GENERATION', maxOutputTokens: 2500, maxModelAttempts: 1 },
    );
  }
  public constructor(
    private readonly client: GeminiStructuredClient,
    private readonly maxConcepts = 12,
  ) {}

  public async extractKnowledge(
    material: StudyMaterial,
    onProgress?: (progress: ExtractionProgress) => Promise<void>,
    outline: MaterialOutlineUnit[] = [],
    options: { maxConcepts?: number; isBookChapter?: boolean; chapterTitle?: string } = {},
  ): Promise<ExtractedKnowledge> {
    const paragraphs = indexMaterialParagraphs(material.content, MAX_EVIDENCE_SPAN_CHARS, outline.map((unit) => unit.startOffset));
    const conceptLimit = options.maxConcepts ?? this.maxConcepts;
    const plan = planExtractionBatches(material, paragraphs, outline, conceptLimit);
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
        options.isBookChapter || plan.book || batches.length > 1,
        options.chapterTitle ? [options.chapterTitle, batch.editorialGuide].filter(Boolean).join('\n') : batch.editorialGuide,
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
      .filter((fragment) => !(plan.book || options.isBookChapter) || !lowLevelCatalogName.test(fragment.name.replace(/([a-z])([A-Z])/g, '$1 $2').trim()))
      .flatMap((fragment) => {
        const source = paragraphById.get(
          fragment.sourceParagraphId.trim().toUpperCase(),
        );
        return source ? [{ ...fragment, sourceExcerpt: source.text, sourceOffset: source.offset }] : [];
      })
    const selected = plan.book
      ? [...plan.chapterLimits].flatMap(([chapterIndex, limit]) => {
          const chapterCandidates = validCandidates.filter((fragment) => fragment.chapterIndex === chapterIndex);
          return selectCentralCandidates(chapterCandidates, limit, plan.chapterTitles.get(chapterIndex));
        })
      : selectCentralCandidates(validCandidates, conceptLimit, options.chapterTitle);
    const fragments = selected
      .map(
        ({
          sourceParagraphId: _sourceParagraphId,
          chapterIndex: _chapterIndex,
          ...fragment
        }) => ({
          ...fragment,
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
      `Você extrai um índice curto dos assuntos CENTRAIS de ${isPartOfBook ? 'um capítulo de livro' : 'um material técnico'} em ${localeName(locale)}. O sumário editorial orienta a escolha dos temas, mas a evidência deve vir do texto indexado. Retorne no máximo ${conceptLimit} conceitos; menos é melhor quando o capítulo é coeso. Em livros, dê prioridade ao tema do próprio capítulo (por exemplo, "Creational Patterns" ou "Structural Patterns") e a no máximo dois mecanismos realmente indispensáveis para compreendê-lo. Se um capítulo lista dezenas de padrões, participantes, classes ou exemplos, NÃO crie um conceito para cada item. Exclua títulos de seção genéricos, papéis como Client/Participant/Subject, nomes de classes e detalhes de implementação, salvo se forem o objetivo central do capítulo. Não repita nomes ou sinônimos entre conceitos. Para cada conceito, retorne nome legível, descrição de até 500 caracteres, kind AXIOM/NODE/EDGE, sourceParagraphId com exatamente um dos IDs fornecidos, premissas fundamentais, casos de borda e prerequisiteNames apenas entre os nomes retornados. Não produza perguntas nesta tarefa: elas são geradas separadamente quando o estudante abre o conceito. Descrições e premissas devem ser sustentadas pelo trecho indicado, não pelo título isolado. Em relations, inclua apenas ligações com proposição e justificativa sustentadas por um único sourceParagraphId que mencione os dois conceitos. Se não houver evidência, retorne relations vazio. Não invente IDs, conteúdo ou relações.${editorialGuide ? `\n\nSUMÁRIO EDITORIAL (guia, não evidência):\n${editorialGuide}` : ''}\n\nMATERIAL INDEXADO:\n${indexedMaterial}`,
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
    }));
    return this.client.generateStructured(
      LocalizedKnowledgeResponseSchema,
      `Localize nomes, descrições, premissas e casos de borda para ${localeName(locale)}. Preserve exatamente cada id, a quantidade de itens e o significado técnico. Não traduza IDs e não acrescente fatos. Perguntas são geradas em outra tarefa; não produza perguntas aqui.\nCONCEITOS: ${asJson(content)}`,
      { operation: 'LOCALIZATION', maxOutputTokens: 5000 },
    );
  }

  private uniqueFragments<T extends { name: string }>(fragments: T[]): T[] {
    const names = new Set<string>();
    return fragments.filter((fragment) => {
      const name = canonicalTopicName(fragment.name);
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
      `Responda em ${localeName(material.locale)}. Gere um Projeto de prática executável, autônomo e objetivo para aplicar os conceitos priorizados. Escolha UM resultado central e no máximo dois conceitos que tenham uma relação prática clara dentro do mesmo artefato; os demais conceitos priorizados podem ficar fora do projeto. Se os conceitos não formarem um exercício coerente, escolha apenas um. O título, o objetivo, os entregáveis e o primeiro passo devem descrever esse mesmo resultado. Não junte dois projetos independentes em um só. Para tamanho SMALL, proponha um artefato pequeno que possa ser iniciado em uma sessão, com até dois entregáveis; para MEDIUM, até quatro entregáveis. Use contexto com no máximo duas frases, objetivo em uma frase, até quatro restrições e um primeiro passo concreto que produza parte do artefato. Não peça envio de solução e não prometa avaliação. Use somente tecnologias sustentadas pelo material ou restrições genéricas. Não invente que um grafo de chamadas mede acoplamento entre módulos sem definir as dependências entre módulos necessárias para a métrica. Ajuste a dificuldade pedida; as lacunas observadas indicam onde o projeto deve exigir raciocínio, mas não provam que o estudante domina ou errou um tema. Títulos de capítulo são contexto, não evidência.\nDIFICULDADE: ${preferences.difficulty ?? 'INTERMEDIATE'}\nTAMANHO: ${preferences.size ?? 'SMALL'}\nLACUNAS OBSERVADAS: ${asJson(preferences.observedGaps ?? [])}\nCAPÍTULOS RELACIONADOS: ${asJson(preferences.chapterTitles ?? [])}\nMATERIAL: ${material.title}\nCONCEITOS PRIORIZADOS EM ORDEM: ${asJson(context)}`,
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
