import { parentPort } from 'node:worker_threads';
import { PDFParse } from 'pdf-parse';
import {
  derivePdfOutlineUnits,
  type EditorialUnit,
} from '../infra/parsers/editorial-structure';

type Request = { data: Uint8Array; maxPages: number; maxCharacters: number };
type Result =
  | { ok: true; text: string; units: EditorialUnit[] }
  | {
      ok: false;
      code: 'PDF_TOO_MANY_PAGES' | 'MATERIAL_TOO_LARGE' | 'INVALID_FILE';
      message: string;
    };

if (!parentPort)
  throw new Error('PDF worker precisa ser executado em uma worker thread.');

parentPort.once(
  'message',
  async ({ data, maxPages, maxCharacters }: Request) => {
    const parser = new PDFParse({ data });
    try {
      const info = await parser.getInfo();
      if (info.total > maxPages) {
        parentPort!.postMessage({
          ok: false,
          code: 'PDF_TOO_MANY_PAGES',
          message: `O PDF excede o limite de ${maxPages} páginas.`,
        } satisfies Result);
        return;
      }

      const pages: string[] = [];
      for (let page = 1; page <= info.total; page += 1) {
        const extracted = await parser.getText({
          partial: [page],
          pageJoiner: '',
        });
        pages.push(extracted.text.trim());
        const text = pages.join('\n');
        if (text.length > maxCharacters) {
          parentPort!.postMessage({
            ok: false,
            code: 'MATERIAL_TOO_LARGE',
            message: `O texto extraído excede ${maxCharacters.toLocaleString('pt-BR')} caracteres. Divida o material antes de enviar.`,
          } satisfies Result);
          return;
        }
      }
      const flattenOutline = (
        items: unknown,
        level = 1,
      ): Array<{ title: string; level: number }> => {
        if (!Array.isArray(items) || level > 6) return [];
        return items.flatMap((item: unknown) => {
          if (
            !item ||
            typeof item !== 'object' ||
            !('title' in item) ||
            typeof item.title !== 'string'
          )
            return [];
          const nested =
            'items' in item ? flattenOutline(item.items, level + 1) : [];
          return [{ title: item.title, level }, ...nested];
        });
      };
      const text = pages.join('\n');
      parentPort!.postMessage({
        ok: true,
        text,
        units: derivePdfOutlineUnits(pages, flattenOutline(info.outline)),
      } satisfies Result);
    } catch {
      parentPort!.postMessage({
        ok: false,
        code: 'INVALID_FILE',
        message: 'Não foi possível ler o PDF.',
      } satisfies Result);
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  },
);
