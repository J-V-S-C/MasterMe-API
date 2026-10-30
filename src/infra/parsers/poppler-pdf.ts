import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SaxesParser } from 'saxes';
import { AppError } from '../../application/errors';
import { derivePdfOutlineUnits, type EditorialUnit } from './editorial-structure';

const execFileAsync = promisify(execFile);
const PDF_PARSE_TIMEOUT_MS = 60_000;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_PROCESS_ADDRESS_SPACE_BYTES = 192 * 1024 * 1024;
export const MAX_PDF_PAGES = 800;

const parsePopplerXml = (xml: string): { text: string; units: EditorialUnit[] } => {
  const pages: string[] = [];
  const outline: Array<{ title: string; level: number; pageNumber?: number }> = [];
  const outlineStack: Array<{ index: number; text: string }> = [];
  let pageLines: string[] | null = null;
  let line: string | null = null;
  let outlineDepth = 0;
  const parser = new SaxesParser();
  parser.on('opentag', (tag) => {
    if (tag.name === 'page') pageLines = [];
    if (tag.name === 'text' && pageLines) line = '';
    if (tag.name === 'outline') outlineDepth++;
    if (tag.name === 'item' && outlineDepth) {
      const page = Number(tag.attributes.page);
      outline.push({ title: '', level: outlineDepth, ...(Number.isInteger(page) && page > 0 ? { pageNumber: page } : {}) });
      outlineStack.push({ index: outline.length - 1, text: '' });
    }
  });
  parser.on('text', (value) => {
    if (line !== null) line += value;
    if (outlineStack.length) outlineStack[outlineStack.length - 1]!.text += value;
  });
  parser.on('closetag', (tag) => {
    if (tag.name === 'text' && line !== null && pageLines) {
      const content = line.trim();
      if (content) {
        pageLines.push(content);
      }
      line = null;
    }
    if (tag.name === 'page' && pageLines) {
      pages.push(pageLines.join('\n'));
      if (pages.length > MAX_PDF_PAGES)
        throw new AppError('PDF_TOO_MANY_PAGES', `O PDF excede o limite de ${MAX_PDF_PAGES} páginas.`);
      pageLines = null;
    }
    if (tag.name === 'item' && outlineStack.length) {
      const item = outlineStack.pop()!;
      outline[item.index]!.title = item.text.trim();
    }
    if (tag.name === 'outline') outlineDepth--;
  });
  parser.write(xml).close();
  if (!pages.length) throw new AppError('INVALID_FILE', 'Não foi possível ler o PDF.');
  const text = pages.join('\n').trim();
  if (!text) throw new AppError('INVALID_FILE', 'PDFs escaneados sem texto não são suportados.');
  return { text, units: derivePdfOutlineUnits(pages, outline.filter((item) => item.title)) };
};

export const extractPdfDocument = async (data: Buffer): Promise<{ text: string; units: EditorialUnit[] }> => {
  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new AppError('INVALID_FILE', 'O arquivo PDF é inválido.');
  const directory = await mkdtemp(join(tmpdir(), 'masterme-pdf-'));
  try {
    const path = join(directory, 'upload.pdf');
    await writeFile(path, data, { mode: 0o600 });
    const { stdout } = await execFileAsync('prlimit', [`--as=${MAX_PROCESS_ADDRESS_SPACE_BYTES}`, '--', 'pdftohtml', '-xml', '-stdout', '-i', '-hidden', '-f', '1', '-l', String(MAX_PDF_PAGES + 1), path], {
      encoding: 'utf8', timeout: PDF_PARSE_TIMEOUT_MS, maxBuffer: MAX_XML_BYTES,
    });
    return parsePopplerXml(stdout);
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && ('killed' in error && error.killed))
      throw new AppError('PDF_PARSE_TIMEOUT', 'O PDF demorou demais para ser processado. Divida o arquivo e tente novamente.');
    throw new AppError('INVALID_FILE', 'Não foi possível ler o PDF com segurança.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
