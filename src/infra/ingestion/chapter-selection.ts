import { MIN_READABLE_TEXT_LENGTH } from '../../application/material-limits';

const MIN_CATALOG_ENTRIES = 3;

export type ExtractableChapter = {
  id: string;
  title: string;
  level: number;
  start_offset: number;
  end_offset: number;
};

/** Keep chapter themes and substantial catalog entries in source order. */
export function selectBookOutlineTopics(chapters: ExtractableChapter[]): ExtractableChapter[] {
  const ordered = [...chapters].sort((left, right) => left.start_offset - right.start_offset);
  const topLevel = Math.min(...ordered.map((unit) => unit.level).filter((level) => level > 0));
  if (!Number.isFinite(topLevel)) return [];
  const selected: ExtractableChapter[] = [];
  for (const [index, parent] of ordered.entries()) {
    if (parent.level !== topLevel) continue;
    selected.push(parent);
    if (!/\bpatterns?\b/i.test(parent.title)) continue;
    const nextParent = ordered.slice(index + 1).find((unit) => unit.level === topLevel);
    const children = ordered.slice(index + 1).filter((unit) =>
      unit.start_offset < (nextParent?.start_offset ?? Infinity) &&
      unit.level > topLevel &&
      !/^\d+\.\d+/.test(unit.title) &&
      !/^discussion of\b/i.test(unit.title),
    );
    if (children.length >= MIN_CATALOG_ENTRIES) selected.push(...children);
  }
  return selected.sort((left, right) => left.start_offset - right.start_offset);
}

export function selectExtractableChapters(content: string, chapters: ExtractableChapter[]) {
  const sourceEnds = new Map<string, number>();
  const sourceOrder = [...chapters].sort((left, right) => left.start_offset - right.start_offset);
  for (const [index, chapter] of sourceOrder.entries()) {
    sourceEnds.set(chapter.id, sourceOrder[index + 1]?.start_offset ?? content.length);
  }
  const units = chapters.filter((chapter) => {
    const title = chapter.title.trim();
    if (/^(?:[A-Z]|contents|foreword|preface|guide to readers|index|bibliography|glossary|design pattern catalog|discussion of .+|chapter\s+\d+\s+conclusion)$/i.test(title.replace(/\s+/g, ' '))) return false;
    const end = sourceEnds.get(chapter.id);
    if (end === undefined || end <= chapter.start_offset) return false;
    const section = content.slice(chapter.start_offset, end).trim().replace(/^#{1,6}\s*/, '');
    const body = section.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())
      ? section.slice(title.length).trim()
      : section;
    return body.length >= MIN_READABLE_TEXT_LENGTH;
  });
  return { units, sourceEnds };
}
