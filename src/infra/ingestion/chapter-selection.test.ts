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

test('does not extract chapter descriptions from a front-matter summary', () => {
  const sections = [
    ['Preface', 'Why this book exists.'],
    ['Chapter 1: Foundations', 'This chapter introduces the subject. SUMMARY OF CHAPTERS'],
    ['Chapter 2: Components', 'This chapter describes what follows.'],
    ['Acknowledgments', 'Thanks to everyone involved.'],
    ['About the Author', 'The author has worked in this field.'],
    ['Guide to This Book', 'The guide explains a substantial technical mechanism. '.repeat(10)],
  ] as const;
  let content = '';
  const chapters = sections.map(([title, body], index) => {
    const start_offset = content.length;
    content += `${title}\n${body}\n`;
    return { id: String(index), title, level: 1, start_offset, end_offset: content.length };
  });

  expect(selectExtractableChapters(content, chapters).units.map((unit) => unit.title)).toEqual([
    'Guide to This Book',
  ]);
});

test('excludes a table of contents before numbered book chapters', () => {
  const table = 'Table of Contents\n1 Introduction ........ 1\n2 Processes ........ 30\n';
  const first = '1 Introduction\nUnix is a family of operating systems.\n';
  const second = '2 Processes\nThe kernel schedules processes.\n';
  const content = table + first + second;
  const chapters = [
    { id: 'table', title: 'Table of Contents', level: 1, start_offset: 0, end_offset: table.length },
    { id: 'first', title: '1 Introduction', level: 1, start_offset: table.length, end_offset: table.length + first.length },
    { id: 'second', title: '2 Processes', level: 1, start_offset: table.length + first.length, end_offset: content.length },
  ];

  expect(selectExtractableChapters(content, chapters).units.map((unit) => unit.title)).toEqual([
    '1 Introduction',
    '2 Processes',
  ]);
});
