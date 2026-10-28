import { fromMarkdown } from 'mdast-util-from-markdown';

export type SourceType = 'TEXT' | 'TXT' | 'MARKDOWN' | 'PDF';
export interface EditorialUnit {
  order: number;
  title: string | null;
  level: number;
  startOffset: number;
  endOffset: number;
  provenance: 'HEADING' | 'PDF_OUTLINE' | 'UNSTRUCTURED' | 'STUDENT';
  pageNumber?: number;
}

function printedChapterHeadings(pageTexts: string[], pageStarts: number[]): Array<{ title: string; level: number; startOffset: number; pageNumber: number }> {
  const headings: Array<{ title: string; level: number; startOffset: number; pageNumber: number }> = [];
  let lastChapter = 0;
  for (const [pageIndex, page] of pageTexts.entries()) {
    const lines = page.split('\n');
    const candidates: Array<{ chapter: number; title: string; lineOffset: number }> = [];
    let lineOffset = 0;
    for (const [index, line] of lines.entries()) {
      const match = line.trim().match(/^(?:chapter|cap[ií]tulo)\s+(\d{1,3})(?:[.:\s-]+)(.+)$/i);
      if (match && !/\.{2,}|\s\d{1,4}$/.test(match[2]!) && match[2]!.length <= 110) {
        candidates.push({ chapter: Number(match[1]), title: line.trim(), lineOffset: lineOffset + line.indexOf(line.trim()) });
      } else if (/^(?:chapter|cap[ií]tulo)\s+\d{1,3}[.:]?$/i.test(line.trim()) && lines[index + 1]?.trim()) {
        const chapter = Number(line.match(/\d{1,3}/)![0]);
        candidates.push({ chapter, title: `${line.trim()} ${lines[index + 1]!.trim()}`, lineOffset: lineOffset + line.indexOf(line.trim()) });
      }
      lineOffset += line.length + 1;
    }
    // A contents page normally lists several chapters; it is a guide, not the chapter body.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0]!;
    if (candidate.chapter <= lastChapter) continue;
    headings.push({ title: candidate.title, level: 1, startOffset: pageStarts[pageIndex]! + candidate.lineOffset, pageNumber: pageIndex + 1 });
    lastChapter = candidate.chapter;
  }
  return headings;
}

/** Recover chapter boundaries from stored PDF text when an older upload has no saved outline. */
export function derivePrintedChapterUnits(content: string): EditorialUnit[] {
  const candidates = Array.from(content.matchAll(/^[ \t]*((?:Chapter|Cap[ií]tulo)\s+(\d{1,3})(?:[.:\s-]+)([^\n]+))/gim)).flatMap((match) => {
    const title = match[1]!.trim();
    const tail = match[3]!.trim();
    if (!tail || tail.length > 110 || /\.{2,}|\s\d{1,4}$/.test(tail)) return [];
    return [{ chapter: Number(match[2]), title, startOffset: match.index + match[0].indexOf(match[1]!) }];
  });
  const runs: typeof candidates[] = [];
  for (const candidate of candidates) {
    const run = runs.at(-1);
    if (!run || candidate.chapter <= run.at(-1)!.chapter) runs.push([candidate]);
    else if (candidate.chapter > run.at(-1)!.chapter) run.push(candidate);
  }
  const best = runs.filter((run) => run.length >= 2).sort((left, right) => (right.at(-1)!.startOffset - right[0]!.startOffset) - (left.at(-1)!.startOffset - left[0]!.startOffset))[0];
  if (!best) return [];
  return best.map((heading, index) => ({ order: index, title: heading.title, level: 1, startOffset: heading.startOffset, endOffset: best[index + 1]?.startOffset ?? content.length, provenance: 'HEADING' }));
}

/** PDF bookmarks are trusted as titles only when the title is found on its own line in extracted page text. */
export function derivePdfOutlineUnits(pageTexts: string[], outline: Array<{ title: string; level: number }>): EditorialUnit[] {
  const content = pageTexts.join('\n');
  const pageStarts: number[] = [];
  let offset = 0;
  for (const page of pageTexts) { pageStarts.push(offset); offset += page.length + 1; }
  const headings: Array<{ title: string; level: number; startOffset: number; pageNumber: number }> = [];
  let minimumPage = 0;
  for (const item of outline.slice(0, 300)) {
    const title = item.title.trim();
    if (!title || item.level < 1 || item.level > 6) continue;
    let found = false;
    for (let pageIndex = minimumPage; pageIndex < pageTexts.length && !found; pageIndex++) {
      let lineOffset = 0;
      for (const line of pageTexts[pageIndex]!.split('\n')) {
        if (line.trim().toLocaleLowerCase() === title.toLocaleLowerCase()) {
          const startOffset = pageStarts[pageIndex]! + lineOffset + line.indexOf(line.trim());
          if (!headings.length || startOffset > headings[headings.length - 1]!.startOffset) {
            headings.push({ title, level: item.level, startOffset, pageNumber: pageIndex + 1 });
            minimumPage = pageIndex;
            found = true;
          }
          break;
        }
        lineOffset += line.length + 1;
      }
    }
  }
  const recovered = headings.length ? [] : derivePrintedChapterUnits(content);
  const printed = recovered.length >= 2
    ? recovered.map((unit) => ({
        title: unit.title!,
        level: unit.level,
        startOffset: unit.startOffset,
        pageNumber: pageStarts.findLastIndex((start) => start <= unit.startOffset) + 1,
      }))
    : printedChapterHeadings(pageTexts, pageStarts);
  const reliable = headings.length ? headings : printed;
  if (!reliable.length) return [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: content.length, provenance: 'UNSTRUCTURED' }];
  const preface: EditorialUnit[] = reliable[0]!.startOffset > 0
    ? [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: reliable[0]!.startOffset, provenance: 'UNSTRUCTURED' }]
    : [];
  return [...preface, ...reliable.map((heading, index) => ({ ...heading, order: index + preface.length, endOffset: reliable[index + 1]?.startOffset ?? content.length, provenance: headings.length ? 'PDF_OUTLINE' as const : 'HEADING' as const }))];
}

/** Preserve author headings only when the source format actually marks them as headings. */
export function deriveEditorialUnits(content: string, sourceType: SourceType): EditorialUnit[] {
  if (sourceType !== 'MARKDOWN') return [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: content.length, provenance: 'UNSTRUCTURED' }];
  const tree = fromMarkdown(content);
  const headings = tree.children.flatMap((node) => {
    if (node.type !== 'heading' || node.position?.start.offset === undefined) return [];
    const title = content.slice(node.position.start.offset, node.position.end.offset)
      .replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();
    return title ? [{ title, level: node.depth, startOffset: node.position.start.offset }] : [];
  });
  if (!headings.length) return [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: content.length, provenance: 'UNSTRUCTURED' }];
  const preface: EditorialUnit[] = headings[0]!.startOffset > 0
    ? [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: headings[0]!.startOffset, provenance: 'UNSTRUCTURED' }]
    : [];
  return [...preface, ...headings.map((heading, index) => ({
    order: index + preface.length,
    title: heading.title,
    level: heading.level,
    startOffset: heading.startOffset,
    endOffset: headings[index + 1]?.startOffset ?? content.length,
    provenance: 'HEADING' as const,
  }))];
}
