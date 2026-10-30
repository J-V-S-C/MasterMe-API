import { expect, test } from 'bun:test';
import {
  deriveEditorialUnits,
  derivePdfOutlineUnits,
  derivePrintedChapterUnits,
} from './editorial-structure';

test('recovers numbered chapters with titles on the following line', () => {
  const content = 'Contents\n3 Creational Patterns 81\n4 Structural Patterns 137\n\nChapter 3\nCreational Patterns\nA factory creates families of objects.\n\nChapter 4\nStructural Patterns\nAn adapter connects incompatible interfaces.';
  const units = derivePrintedChapterUnits(content);
  expect(units.map((unit) => unit.title)).toEqual(['Chapter 3\nCreational Patterns', 'Chapter 4\nStructural Patterns']);
  expect(units[0]?.startOffset).toBe(content.indexOf('Chapter 3\nCreational Patterns'));
});

test('rejects code sample chapter labels when the contents names different chapters', () => {
  const content = 'Contents\n3 Creational Patterns 81\n4 Structural Patterns 137\n5 Behavioral Patterns 221\n\nCHAPTER 4\nBTree* _fonts;\n\nChapter 3\nCreational Patterns\nThe creation chapter.\nChapter 4\nStructural Patterns\nThe composition chapter.\nChapter 5\nBehavioral Patterns\nThe behavior chapter.';
  expect(derivePrintedChapterUnits(content).map((unit) => unit.title)).toEqual(['Chapter 3\nCreational Patterns', 'Chapter 4\nStructural Patterns', 'Chapter 5\nBehavioral Patterns']);
});

test('bookmark page numbers find the actual pattern body after an earlier contents mention', () => {
  const pages = ['Abstract Factory\nListed in the contents.', 'Chapter 3\nCreational Patterns\nFamilies of objects.', 'Abstract Factory\nThe pattern body explains related object families.'];
  const units = derivePdfOutlineUnits(pages, [
    { title: '3 Creational Patterns', level: 2, pageNumber: 2 },
    { title: 'Abstract Factory', level: 3, pageNumber: 3 },
  ]);
  expect(units.find((unit) => unit.title === 'Abstract Factory')?.pageNumber).toBe(3);
});

test('Markdown headings preserve editorial order and source offsets', () => {
  const content =
    '# Livro\nIntrodução.\n## Capítulo um\nTexto.\n### Seção\nOutro texto.\n## Capítulo dois\nFim.';
  const units = deriveEditorialUnits(content, 'MARKDOWN');
  expect(units.map((unit) => [unit.title, unit.level])).toEqual([
    ['Livro', 1],
    ['Capítulo um', 2],
    ['Seção', 3],
    ['Capítulo dois', 2],
  ]);
  for (const unit of units)
    expect(
      content.slice(unit.startOffset, unit.endOffset).startsWith('#'),
    ).toBe(true);
});

test('plain text and PDF text remain one honest unit without reliable outline', () => {
  expect(deriveEditorialUnits('Capítulo 1\nTexto', 'PDF')).toEqual([
    {
      order: 0,
      title: null,
      level: 0,
      startOffset: 0,
      endOffset: 16,
      provenance: 'UNSTRUCTURED',
    },
  ]);
});

test('plain-text books use body chapter headings instead of contents entries', () => {
  const content = [
    'Contents',
    '1. Preface (08:03 mins)',
    '2. 1. Introduction (34:30 mins)',
    '3. 2. Architectural Thinking (23:00 mins)',
    '',
    'Chapter 1. Introduction',
    'The chapter explains what an architect does.',
    'Chapter 2. Architectural Thinking',
    'The chapter explains the work of architectural thinking.',
  ].join('\n');
  for (const sourceType of ['TEXT', 'TXT'] as const) {
    const units = deriveEditorialUnits(content, sourceType);
    expect(units.map((unit) => unit.title)).toEqual([null, 'Chapter 1. Introduction', 'Chapter 2. Architectural Thinking']);
    expect(units[1]!.startOffset).toBe(content.indexOf('Chapter 1. Introduction'));
    expect(units[2]!.startOffset).toBe(content.indexOf('Chapter 2. Architectural Thinking'));
  }
});

test('PDF outline uses only headings located as standalone text on the corresponding page', () => {
  const pages = [
    'Sumário\nCapítulo um ..... 2',
    'Capítulo um\nTexto inicial',
    'Capítulo dois\nOutro texto',
  ];
  const units = derivePdfOutlineUnits(pages, [
    { title: 'Capítulo um', level: 1 },
    { title: 'Capítulo dois', level: 1 },
  ]);
  expect(
    units.map(({ title, pageNumber, provenance }) => [
      title,
      pageNumber,
      provenance,
    ]),
  ).toEqual([
    [null, undefined, 'UNSTRUCTURED'],
    ['Capítulo um', 2, 'PDF_OUTLINE'],
    ['Capítulo dois', 3, 'PDF_OUTLINE'],
  ]);
  expect(
    pages
      .join('\n')
      .slice(units[1]!.startOffset, units[1]!.endOffset)
      .startsWith('Capítulo um'),
  ).toBe(true);
  expect(units[0]!.startOffset).toBe(0);
  expect(units.at(-1)!.endOffset).toBe(pages.join('\n').length);
});

test('flat pattern bookmarks give way to printed chapter headings', () => {
  const pages = [
    'Contents\n3 Creational Patterns 81\nAbstract Factory 87\nBuilder 97\n4 Structural Patterns 137\nAdapter 139',
    'Chapter 3\nCreational Patterns\nThese patterns govern object creation.\nAbstract Factory\nFactory detail.\nBuilder\nBuilder detail.',
    'Chapter 4\nStructural Patterns\nThese patterns govern composition.\nAdapter\nAdapter detail.',
  ];
  const units = derivePdfOutlineUnits(pages, [
    { title: 'Abstract Factory', level: 1 }, { title: 'Builder', level: 1 }, { title: 'Adapter', level: 1 },
  ]);
  expect(units.map((unit) => unit.title)).toEqual([null, 'Chapter 3\nCreational Patterns', 'Chapter 4\nStructural Patterns']);
  expect(units.slice(1).every((unit) => unit.provenance === 'HEADING')).toBe(true);
});

test('printed chapter headings supply order when PDF bookmarks are absent', () => {
  const pages = [
    'Contents\nChapter 1. Foundations .... 3\nChapter 2. Components .... 7',
    'Chapter 1. Foundations\nThe first chapter explains the foundation.',
    'Chapter 2. Components\nThe second chapter explains components.',
  ];
  const units = derivePdfOutlineUnits(pages, []);
  expect(units.map((unit) => [unit.title, unit.provenance, unit.pageNumber ?? null])).toEqual([
    [null, 'UNSTRUCTURED', null],
    ['Chapter 1. Foundations', 'HEADING', 2],
    ['Chapter 2. Components', 'HEADING', 3],
  ]);
  const content = pages.join('\n');
  expect(content.slice(units[1]!.startOffset, units[1]!.endOffset).startsWith('Chapter 1. Foundations')).toBe(true);
});

test('printed chapters recover a PDF with only one matching bookmark', () => {
  const pages = [
    'Contents\nChapter 1. Foundations\nChapter 2. Components',
    'Chapter 1. Foundations\nThe first chapter body.',
    'Chapter 2. Components\nThe second chapter body.',
  ];
  const units = derivePdfOutlineUnits(pages, [{ title: 'Chapter 1. Foundations', level: 1 }]);
  expect(units.map((unit) => unit.title)).toEqual([null, 'Chapter 1. Foundations', 'Chapter 2. Components']);
  expect(units[1]!.startOffset).toBe(pages.join('\n').lastIndexOf('Chapter 1. Foundations'));
});

test('legacy PDF text prefers chapter bodies after a plain contents list', () => {
  const content = 'Contents\nChapter 1. Foundations\nChapter 2. Components\n\nChapter 1. Foundations\n' + 'Foundations in detail. '.repeat(30) + '\nChapter 2. Components\nComponents in detail.';
  const units = derivePrintedChapterUnits(content);
  expect(units.map((unit) => unit.title)).toEqual(['Chapter 1. Foundations', 'Chapter 2. Components']);
  expect(units[0]!.startOffset).toBe(content.lastIndexOf('Chapter 1. Foundations'));
});

test('Markdown preface remains readable before the first heading', () => {
  const content = 'Prefácio sem título\n\n# Capítulo\nTexto';
  const units = deriveEditorialUnits(content, 'MARKDOWN');
  expect(units.map(({ provenance }) => provenance)).toEqual([
    'UNSTRUCTURED',
    'HEADING',
  ]);
  expect(units[0]!.startOffset).toBe(0);
  expect(units[0]!.endOffset).toBe(units[1]!.startOffset);
});
