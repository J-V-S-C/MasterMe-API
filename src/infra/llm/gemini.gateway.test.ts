import { describe, expect, test } from 'bun:test'
import { batchIndexedParagraphs, GeminiMasterMeGateway, indexMaterialParagraphs, planExtractionBatches, relationNamesInExcerpt, splitMaterialForExtraction } from './gemini.gateway'
import type { GeminiStructuredClient } from './gemini-structured.client'
import type { Concept } from '../../application/domain/concept'

test('generates all concept questions in one billed provider request', async () => {
  const calls: Array<{ operation: string; maxOutputTokens: number; maxModelAttempts?: number }> = [];
  const prompts: string[] = [];
  const client = { generateStructured: async (_schema: unknown, prompt: string, options: { operation: string; maxOutputTokens: number; maxModelAttempts?: number }) => {
    calls.push(options);
    prompts.push(prompt);
    return {
      explanation: { text: 'How does the caller provide a dependency to the component, and why?', targetPremise: 'Caller provides a dependency.', expectedReasoningSteps: ['Identify caller', 'Explain provision'], learningObjective: 'Explain provision.', requiredIdeas: ['Caller', 'Provision'], commonMisconceptions: [] },
      reasoning: 'Why does the caller provide the dependency in this passage?',
      application: 'How would a caller provide the dependency in a small example?',
      challenge: 'How would dependency provision work if the caller were missing?',
      retention: 'Without the passage, explain how the caller supplies dependencies.',
      practice: 'Build a small example where the caller supplies the dependency.',
    };
  } } as unknown as GeminiStructuredClient;
  const concept: Concept = { id: '11111111-1111-4111-8111-111111111111', materialId: '22222222-2222-4222-8222-222222222222', name: 'Dependency provision', description: 'The caller provides a dependency.', kind: 'NODE', sourceExcerpt: 'The caller provides a dependency to the component.', fundamentalPremises: ['The caller provides it.'], edgeCases: ['The caller cannot provide it.'], generatedLocale: 'en-US', prerequisiteIds: [], nextIds: [] };
  const bundle = await new GeminiMasterMeGateway(client).generateQuestionBundle(concept);
  expect(bundle.practice).toContain('Build');
  expect(calls).toEqual([{ operation: 'QUESTION_SET_GENERATION', maxOutputTokens: 2500, maxModelAttempts: 1 }]);
  expect(prompts[0]).toContain('Do not state the mechanism, steps, conditions, or conclusion');
  expect(prompts[0]).toContain('give a small concrete situation');
  expect(prompts[0]).toContain('ask for the key ideas from memory without restating them');
});

test('a weak optional question does not block a valid initial study question', async () => {
  const client = { generateStructured: async () => ({
    explanation: { text: 'How does the caller provide a dependency to the component, and why?', targetPremise: 'Caller provides a dependency.', expectedReasoningSteps: ['Identify caller', 'Explain provision'], learningObjective: 'Explain provision.', requiredIdeas: ['Caller', 'Provision'], commonMisconceptions: [] },
    reasoning: 'What is the meaning of this dependency?',
    application: 'How would a caller provide the dependency in a small example?',
    challenge: 'How would dependency provision work if the caller were missing?',
    retention: 'Without the passage, explain how the caller supplies dependencies.',
    practice: 'Build a small example where the caller supplies the dependency.',
  }) } as unknown as GeminiStructuredClient;
  const concept: Concept = { id: '11111111-1111-4111-8111-111111111111', materialId: '22222222-2222-4222-8222-222222222222', name: 'Dependency provision', description: 'The caller provides a dependency.', kind: 'NODE', sourceExcerpt: 'The caller provides a dependency to the component.', fundamentalPremises: ['The caller provides it.'], edgeCases: ['The caller cannot provide it.'], generatedLocale: 'en-US', prerequisiteIds: [], nextIds: [] };
  const bundle = await new GeminiMasterMeGateway(client).generateQuestionBundle(concept);
  expect(bundle.explanation.text).toContain('caller provide a dependency');
});

test('keeps a custom question that paraphrases the source', async () => {
  let calls = 0;
  const client = { generateStructured: async () => {
    calls += 1;
    return {
      explanation: { text: 'How does the component get the resource it needs from the calling code?', targetPremise: 'Caller provides a dependency.', expectedReasoningSteps: ['Identify caller', 'Explain provision'], learningObjective: 'Explain provision.', requiredIdeas: ['Caller', 'Provision'], commonMisconceptions: [] },
      reasoning: 'Why does the caller provide the dependency in this passage?',
      application: 'How would a caller provide the dependency in a small example?',
      challenge: 'How would dependency provision work if the caller were missing?',
      retention: 'Without the passage, explain how the caller supplies dependencies.',
      practice: 'Build a small example where the caller supplies the dependency.',
    };
  } } as unknown as GeminiStructuredClient;
  const concept: Concept = { id: '11111111-1111-4111-8111-111111111111', materialId: '22222222-2222-4222-8222-222222222222', name: 'Dependency provision', description: 'The caller provides a dependency.', kind: 'NODE', sourceExcerpt: 'The caller provides a dependency to the component.', fundamentalPremises: ['The caller provides it.'], edgeCases: ['The caller cannot provide it.'], generatedLocale: 'en-US', prerequisiteIds: [], nextIds: [] };
  const bundle = await new GeminiMasterMeGateway(client).generateQuestionBundle(concept);
  expect(bundle.explanation.text).toBe('How does the component get the resource it needs from the calling code?');
  expect(bundle.explanation.targetPremise).toBe('Caller provides a dependency.');
  expect(calls).toBe(1);
});

test('checkpointed book chapters keep the same small concept budget', async () => {
  const prompts: string[] = [];
  const client = { generateStructured: async (_schema: unknown, prompt: string) => {
    prompts.push(prompt);
    const id = prompt.match(/\[(P\d+)\]/)?.[1] ?? 'P0001';
    return { fragments: Array.from({ length: 7 }, (_, index) => ({
      name: index === 6 ? 'Creational Patterns' : `Central idea ${index + 1}`, description: 'An idea supported by the chapter.', kind: 'NODE', sourceParagraphId: id,
      fundamentalPremises: ['The chapter supports this idea.'], edgeCases: ['A boundary of the idea.'], prerequisiteNames: [],
    })), relations: [] };
  } } as unknown as GeminiStructuredClient;
  const material = { id: 'book', title: 'Patterns', content: 'Chapter 3\nCreational Patterns\nCreational patterns govern the process of object creation.', locale: 'en-US' as const, materialKind: 'ARTICLE' as const, createdAt: new Date().toISOString() };
  const result = await new GeminiMasterMeGateway(client).extractKnowledge(material, undefined, [], { maxConcepts: 3, isBookChapter: true, chapterTitle: 'Chapter 3 Creational Patterns' });
  expect(result.fragments).toHaveLength(3);
  expect(result.fragments.map((fragment) => fragment.name)).toContain('Creational Patterns');
  expect(result.fragments.every((fragment) => fragment.studyQuestion === undefined && fragment.edgeCaseQuestion === undefined)).toBe(true);
  expect(prompts[0]).toContain('Chapter 3 Creational Patterns');
  expect(prompts[0]?.toLowerCase()).toContain('não produza perguntas');
});

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


  test('bounds evidence chunks and starts each on a word boundary when possible', () => {
    const content = 'A complete sentence about one idea. '.repeat(110);
    const paragraphs = indexMaterialParagraphs(content, 160);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((paragraph) => paragraph.text.length <= 160)).toBe(true);
    expect(paragraphs.map(({ text }) => text).join('')).toBe(content.trim());
    expect(paragraphs.every((paragraph) => content.slice(paragraph.offset, paragraph.offset + paragraph.text.length) === paragraph.text)).toBe(true);
    expect(paragraphs.slice(1).every((paragraph) => /^[A-Z]/.test(paragraph.text))).toBe(true);
  })

  test('keeps distinct offsets for repeated source paragraphs', () => {
    const content = 'Same source.\n\nSame source.';
    expect(indexMaterialParagraphs(content).map(({ offset }) => offset)).toEqual([0, 14]);
  })

  test('starts a new evidence span at a chapter heading without a blank line', () => {
    const content = 'Pipeline architecture has a monolithic deployment.\nChapter 12. Microkernel Architecture Style\nA microkernel has a core and plug-in components.';
    const spans = indexMaterialParagraphs(content);
    expect(spans.map(({ text }) => text)).toEqual([
      'Pipeline architecture has a monolithic deployment.',
      'Chapter 12. Microkernel Architecture Style\nA microkernel has a core and plug-in components.',
    ]);
    expect(spans.every(({ text, offset }) => content.slice(offset, offset + text.length) === text)).toBe(true);
    const inline = 'See pricing options. Chapter 12. Microkernel Architecture Style\nA core and plug-ins.';
    expect(indexMaterialParagraphs(inline).map(({ text }) => text)).toEqual([
      'See pricing options.',
      'Chapter 12. Microkernel Architecture Style\nA core and plug-ins.',
    ]);
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

  test('uses editorial boundaries even when chapter titles are not numbered', () => {
    const content = 'Prior material.\nChapter One\nThe first idea.';
    const offset = content.indexOf('Chapter One');
    expect(indexMaterialParagraphs(content, 1600, [offset]).map(({ text }) => text)).toEqual([
      'Prior material.',
      'Chapter One\nThe first idea.',
    ]);
  });
})

test('book extraction follows chapter order without a twelve-concept material cap', async () => {
  const chapters = Array.from({ length: 15 }, (_, index) => `Chapter ${index + 1}. Topic ${index + 1}\nThis chapter explains topic ${index + 1} in its own context.`);
  const content = chapters.join('\n\n');
  const outline = chapters.map((chapter, index) => ({
    order: index, title: `Chapter ${index + 1}. Topic ${index + 1}`, level: 1,
    startOffset: content.indexOf(chapter), endOffset: content.indexOf(chapter) + chapter.length,
    provenance: 'HEADING' as const, pageNumber: index + 1,
  }));
  let calls = 0;
  const client = { generateStructured: async (_schema: unknown, prompt: string) => {
    calls++;
    const id = prompt.match(/\[(P\d+)\]/)?.[1];
    return { fragments: [{ name: `Topic ${calls}`, description: `Topic ${calls} is explained in this chapter.`, kind: 'NODE', sourceParagraphId: id,
      fundamentalPremises: ['The topic is explained.'], edgeCases: ['The topic changes.'], edgeCaseQuestion: 'How does this topic behave when conditions change?',
      questionText: 'How does this topic work according to its chapter?', targetPremise: 'The chapter explains the topic.', expectedReasoningSteps: ['Read', 'Explain'],
      learningObjective: 'Explain the topic.', requiredIdeas: ['Main point', 'Supporting detail'], commonMisconceptions: [], prerequisiteNames: [] }], relations: [] };
  } } as unknown as GeminiStructuredClient;
  const material = { id: 'book', title: 'Book', content, locale: 'en-US' as const, sourceType: 'PDF' as const, createdAt: new Date().toISOString() };
  const result = await new GeminiMasterMeGateway(client).extractKnowledge(material, undefined, outline);
  expect(calls).toBe(15);
  expect(result.fragments).toHaveLength(15);
  expect(result.fragments.every((fragment, index) => fragment.sourceExcerpt.includes(`Topic ${index + 1}`))).toBe(true);
});

test('explicit material kind controls chapter extraction without rewriting legacy inference', () => {
  const content = 'Chapter 1. Start\nThe first mechanism.\n\nChapter 2. Continue\nThe second mechanism.';
  const outline = [
    { order: 0, title: 'Chapter 1. Start', level: 1, startOffset: 0, endOffset: content.indexOf('Chapter 2'), provenance: 'HEADING' as const },
    { order: 1, title: 'Chapter 2. Continue', level: 1, startOffset: content.indexOf('Chapter 2'), endOffset: content.length, provenance: 'HEADING' as const },
  ];
  const material = { id: 'material', title: 'Reading', content, locale: 'en-US' as const, sourceType: 'PDF' as const, createdAt: new Date().toISOString() };
  const paragraphs = indexMaterialParagraphs(content);
  expect(planExtractionBatches({ ...material, materialKind: 'ARTICLE' }, paragraphs, outline).book).toBe(false);
  expect(planExtractionBatches({ ...material, materialKind: 'BOOK' }, paragraphs, outline).book).toBe(true);
  expect(planExtractionBatches(material, paragraphs, outline).book).toBe(true);
});

test('a book with a legacy unstructured outline can recover printed chapters for re-extraction', () => {
  const content = 'Contents\n1. Introduction (34:30 mins)\n2. Modularity (28:45 mins)\n\nChapter 1. Introduction\nThe introduction explains the architect role.\n\nChapter 2. Modularity\nThe second chapter explains modularity.';
  const material = { id: 'book', title: 'Book', content, locale: 'en-US' as const, sourceType: 'TEXT' as const, materialKind: 'BOOK' as const, createdAt: new Date().toISOString() };
  const outline = [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: content.length, provenance: 'UNSTRUCTURED' as const }];
  const plan = planExtractionBatches(material, indexMaterialParagraphs(content), outline);
  expect(plan.book).toBe(true);
  expect(plan.chapterLimits.size).toBe(2);
  expect(plan.batches.every((batch) => batch.paragraphs.every((paragraph) => paragraph.offset >= content.indexOf('Chapter 1. Introduction')))).toBe(true);
});

test('a flat PDF pattern index yields chapter-sized concept limits instead of one unit per pattern', () => {
  const content = [
    'Contents\n3 Creational Patterns 81\nAbstract Factory 87\nBuilder 97\n4 Structural Patterns 137\nAdapter 139\nBridge 151',
    'Chapter 3\nCreational Patterns\nCreational patterns separate object creation from use. Abstract Factory and Builder are examples of different creation needs.',
    'Chapter 4\nStructural Patterns\nStructural patterns compose classes and objects. Adapter and Bridge illustrate distinct composition choices.',
  ].join('\n\n');
  const outline = ['Abstract Factory', 'Builder', 'Adapter', 'Bridge'].map((title, order) => ({
    order, title, level: 1, startOffset: content.indexOf(title, content.indexOf('Chapter 3')),
    endOffset: content.length, provenance: 'PDF_OUTLINE' as const,
  }));
  const plan = planExtractionBatches({ id: 'book', title: 'Patterns', content, locale: 'en-US', materialKind: 'BOOK', sourceType: 'PDF', createdAt: new Date().toISOString() }, indexMaterialParagraphs(content), outline);
  expect(plan.book).toBe(true);
  expect(plan.chapterLimits.size).toBe(2);
  expect([...plan.chapterLimits.values()].every((limit) => limit <= 3)).toBe(true);
  expect(plan.batches.every((batch) => batch.paragraphs.every((paragraph) => paragraph.offset >= content.indexOf('Chapter 3')))).toBe(true);
});

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
  expect(result.fragments[0]?.sourceOffset).toBe(0)
  expect(result.fragments[1]?.sourceExcerpt).toBe('x'.repeat(1_600))
  expect(result.fragments[1]?.sourceOffset).toBeGreaterThanOrEqual(material.content.indexOf('x'))
  const second = result.fragments[1];
  if (!second || second.sourceOffset === undefined) throw new Error('Second cited fragment is missing its offset.');
  expect(material.content.slice(second.sourceOffset, second.sourceOffset + 1_600))
    .toBe(second.sourceExcerpt)
  expect(material.content.includes(result.fragments[1]!.sourceExcerpt)).toBe(true)
})

test('relations require both named concepts in the cited paragraph', () => {
  expect(relationNamesInExcerpt('Parser', 'Query Plan', 'The parser turns a query into a syntax tree.')).toBe(false)
  expect(relationNamesInExcerpt('Parser', 'Predicate', 'The parser preserves predicates.')).toBe(true)
  expect(relationNamesInExcerpt('Index Scan', 'Query Planner', 'The planner compares index scans.')).toBe(true)
})
