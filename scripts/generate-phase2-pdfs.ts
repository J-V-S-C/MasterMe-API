import { writeFile } from 'node:fs/promises';

export type Page = { lines: string[]; heading?: string };

const escapeText = (value: string): string => value.replace(/[\\()]/g, '\\$&');

export function makePdf(pages: Page[], withOutline: boolean): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesRoot = add('');
  const outlineRoot = withOutline ? add('') : 0;
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = add('');
    const content = `BT /F1 14 Tf 50 750 Td 18 TL ${page.lines.map((line, index) => `${index ? 'T* ' : ''}(${escapeText(line)}) Tj`).join(' ')} ET`;
    const streamId = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  if (withOutline) {
    const headingPages = pages.map((page, index) => ({ ...page, index })).filter((page) => page.heading);
    const outlineIds = headingPages.map(() => add(''));
    objects[outlineRoot - 1] = `<< /Type /Outlines /First ${outlineIds[0]} 0 R /Last ${outlineIds.at(-1)} 0 R /Count ${outlineIds.length} >>`;
    headingPages.forEach((page, index) => {
      objects[outlineIds[index]! - 1] = `<< /Title (${escapeText(page.heading!)}) /Parent ${outlineRoot} 0 R /Dest [${pageIds[page.index]} 0 R /Fit]${index ? ` /Prev ${outlineIds[index - 1]} 0 R` : ''}${index + 1 < outlineIds.length ? ` /Next ${outlineIds[index + 1]} 0 R` : ''} >>`;
    });
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R${withOutline ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''} >>`;
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

if (import.meta.main) {
  const directory = new URL('../test-fixtures/phase2/', import.meta.url);
  await writeFile(new URL('outlined-book.pdf', directory), makePdf([
    { lines: ['Contents', 'Chapter One ........ 2', 'Chapter Two ........ 3'] },
    { heading: 'Chapter One', lines: ['Chapter One', 'An index narrows the rows inspected by a query.'] },
    { heading: 'Chapter Two', lines: ['Chapter Two', 'A planner compares scans and joins before execution.'] },
  ], true));
  await writeFile(new URL('unstructured.pdf', directory), makePdf([
    { lines: [
      'A query planner compares candidate access paths before execution.',
      'A sequential scan reads each row, while an index scan first narrows candidate rows.',
      'The planner uses table statistics to estimate work and choose an access path.',
      'These notes have no author supplied chapter hierarchy.',
    ] },
  ], false));
}
