import { parentPort } from 'node:worker_threads'
import { PDFParse } from 'pdf-parse'

type Request = { data: Uint8Array; maxPages: number; maxCharacters: number }
type Result =
  | { ok: true; text: string }
  | { ok: false; code: 'PDF_TOO_MANY_PAGES' | 'MATERIAL_TOO_LARGE' | 'INVALID_FILE'; message: string }

if (!parentPort) throw new Error('PDF worker precisa ser executado em uma worker thread.')

parentPort.once('message', async ({ data, maxPages, maxCharacters }: Request) => {
  const parser = new PDFParse({ data })
  try {
    const info = await parser.getInfo()
    if (info.total > maxPages) {
      parentPort!.postMessage({ ok: false, code: 'PDF_TOO_MANY_PAGES', message: `O PDF excede o limite de ${maxPages} páginas.` } satisfies Result)
      return
    }

    let text = ''
    for (let page = 1; page <= info.total; page += 1) {
      const extracted = await parser.getText({ partial: [page], pageJoiner: '' })
      text += `${text ? '\n' : ''}${extracted.text}`
      if (text.length > maxCharacters) {
        parentPort!.postMessage({ ok: false, code: 'MATERIAL_TOO_LARGE', message: `O texto extraído excede ${maxCharacters.toLocaleString('pt-BR')} caracteres. Divida o material antes de enviar.` } satisfies Result)
        return
      }
    }
    parentPort!.postMessage({ ok: true, text: text.trim() } satisfies Result)
  } catch {
    parentPort!.postMessage({ ok: false, code: 'INVALID_FILE', message: 'Não foi possível ler o PDF.' } satisfies Result)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
})
