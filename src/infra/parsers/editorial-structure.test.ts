import { expect, test } from 'bun:test';
import {
  deriveEditorialUnits,
  derivePdfOutlineUnits,
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
