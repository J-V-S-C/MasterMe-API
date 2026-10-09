import { describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import type { IngestionService } from '../services/ingestion.service'
import type { MasterMeService } from '../services/masterme.service'
import { createApp } from '../../server'

const withUploadServer = async (run: (baseUrl: string) => Promise<void>): Promise<void> => {
  const study = {} as MasterMeService
  const ingestion = { upload: async () => { throw new Error('upload não deveria ser chamado') } } as unknown as IngestionService
  const server: Server = createApp(study, ingestion).listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.')
  try { await run(`http://127.0.0.1:${address.port}`) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

describe('guardrails multipart de upload', () => {
  test('rejeita arquivo acima de 8 MiB antes do serviço', async () => {
    await withUploadServer(async (baseUrl) => {
      const form = new FormData()
      form.set('file', new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'text/plain' }), 'large.txt')
      const response = await fetch(`${baseUrl}/api/materials/upload`, { method: 'POST', body: form })
      expect(response.status).toBe(413)
      expect(await response.json()).toMatchObject({ code: 'UPLOAD_TOO_LARGE' })
    })
  })

  test('rejeita campos multipart excedentes e arquivo ausente como erro do cliente', async () => {
    await withUploadServer(async (baseUrl) => {
      const excess = new FormData()
      excess.set('file', new Blob(['conteúdo suficiente para upload'], { type: 'text/plain' }), 'material.txt')
      excess.set('title', 'Material')
      excess.set('locale', 'pt-BR')
      excess.set('extra', 'não permitido')
      const excessResponse = await fetch(`${baseUrl}/api/materials/upload`, { method: 'POST', body: excess })
      expect(excessResponse.status).toBe(400)
      expect(await excessResponse.json()).toMatchObject({ code: 'INVALID_UPLOAD' })

      const missing = new FormData()
      missing.set('title', 'Sem arquivo')
      const missingResponse = await fetch(`${baseUrl}/api/materials/upload`, { method: 'POST', body: missing })
      expect(missingResponse.status).toBe(400)
      expect(await missingResponse.json()).toMatchObject({ code: 'INVALID_UPLOAD' })
    })
  })
})
