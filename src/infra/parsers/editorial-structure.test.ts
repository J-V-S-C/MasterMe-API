import { expect, test } from 'bun:test';
import {
  deriveEditorialUnits,
  derivePdfOutlineUnits,
  derivePrintedChapterUnits,
} from './editorial-structure';

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
