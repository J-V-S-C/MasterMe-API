import { fromMarkdown } from 'mdast-util-from-markdown';

export type SourceType = 'TEXT' | 'TXT' | 'MARKDOWN' | 'PDF';
export interface EditorialUnit {
  order: number;
  title: string | null;
  level: number;
  startOffset: number;
  endOffset: number;
  provenance: 'HEADING' | 'PDF_OUTLINE' | 'UNSTRUCTURED';
  pageNumber?: number;
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
  if (!headings.length) return [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: content.length, provenance: 'UNSTRUCTURED' }];
  const preface: EditorialUnit[] = headings[0]!.startOffset > 0
    ? [{ order: 0, title: null, level: 0, startOffset: 0, endOffset: headings[0]!.startOffset, provenance: 'UNSTRUCTURED' }]
    : [];
  return [...preface, ...headings.map((heading, index) => ({ ...heading, order: index + preface.length, endOffset: headings[index + 1]?.startOffset ?? content.length, provenance: 'PDF_OUTLINE' as const }))];
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
