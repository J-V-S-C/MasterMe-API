import { expect, test } from 'bun:test';
import { selectBookOutlineTopics, selectExtractableChapters } from './chapter-selection';

test('skips title-only PDF outline entries while preserving the next chapter span', () => {
  const content = 'ContentsPrefaceForewordGuide to Readers\nThis section explains how the reader should use the book.';
  const titles = ['Contents', 'Preface', 'Foreword', 'Guide to Readers'];
  let start = 0;
  const chapters = titles.map((title, index) => {
    const chapter = { id: String(index), title, level: 1, start_offset: start, end_offset: start + title.length };
    start += title.length;
    return chapter;
  });

  const selection = selectExtractableChapters(content, chapters);

  expect(selection.units).toHaveLength(0);
  expect(selection.sourceEnds.get('2')).toBe(chapters[3]?.start_offset);
  expect(selection.sourceEnds.get('3')).toBe(content.length);
});

test('keeps a catalog overview and its named entries without selecting index letters', () => {
  const titles = ['Design Pattern Catalog', '3 Creational Patterns', 'Abstract Factory', 'Builder', 'Factory Method', 'Index', 'A'];
  const units = titles.map((title, index) => ({ id: String(index), title, level: index === 0 || index >= 5 ? 1 : index === 1 ? 2 : 3, start_offset: index * 100, end_offset: (index + 1) * 100 }));
  expect(selectBookOutlineTopics(units).map((unit) => unit.title)).toEqual(titles.slice(0, 6).concat('A'));
  const text = titles.map((title) => `${title} ${'Body text. '.repeat(10)}`).join('');
  expect(selectExtractableChapters(text, selectBookOutlineTopics(units)).units.map((unit) => unit.title)).not.toContain('A');
});
