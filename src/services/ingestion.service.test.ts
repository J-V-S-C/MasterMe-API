import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { MAX_MATERIAL_LENGTH } from '../domain/masterme'
import { classifyProcessingFailure, extractPdfText, IngestionService, LocalMaterialStorage, MAX_PDF_PAGES } from './ingestion.service'

describe('classifyProcessingFailure', () => {
  test('interrompe retentativas quando a cota diária do provedor acabou', () => {
    const failure = classifyProcessingFailure(new Error('429 Too Many Requests: generate_content_free_tier_requests quota exceeded'))
    expect(failure).toEqual({
      retryable: false,
      message: 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    })
  })

  test('não repete automaticamente falhas definitivas de extração', () => {
    expect(classifyProcessingFailure(new Error('material schema conflict'))).toEqual({
      retryable: false,
      message: 'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias dos modelos Gemini', () => {
    expect(classifyProcessingFailure(new Error('Gemini quota or availability exhausted for all configured models: gemini-3.5-flash-lite'))).toEqual({
      retryable: true,
      message: 'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })

  test('repete falhas transitórias de rede', () => {
    expect(classifyProcessingFailure(new Error('Unable to connect. Is the computer able to access the url?'))).toEqual({
      retryable: true,
      message: 'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    })
  })
})

describe('eventos de atividade', () => {
  test('persiste e notifica o usuário na mesma instrução PostgreSQL', async () => {
    const pool = new Pool()
    const query = spyOn(pool, 'query').mockImplementation(async () => ({ rows: [{ id: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] }))
    try {
      await new IngestionService(pool, new LocalMaterialStorage('/tmp/masterme-ingestion-test')).event('session.updated', { sessionId: 'session-a' }, '00000000-0000-4000-8000-000000000001')
      const call = query.mock.calls[0] as unknown as [unknown, unknown[]]
      expect(String(call[0])).toContain("pg_notify('masterme_activity'")
      expect(call[1]).toEqual(['session.updated', JSON.stringify({ sessionId: 'session-a' }), '00000000-0000-4000-8000-000000000001'])
    } finally { query.mockRestore(); await pool.end() }
  })
})

const uploadFile = (content: string): Express.Multer.File => ({
  fieldname: 'file',
  originalname: 'material.txt',
  encoding: '7bit',
  mimetype: 'text/plain',
  size: Buffer.byteLength(content),
  buffer: Buffer.from(content),
  stream: undefined as never,
  destination: '',
  filename: '',
  path: '',
})

const buildPdf = (pageCount: number, text = 'Conteúdo PDF válido para teste'): Buffer => {
  const chunks = text.match(/[\s\S]{1,1_000}/g) ?? []
  const textOperations = chunks.map((chunk) => {
    const escaped = chunk.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
    return `(${escaped}) Tj`
  }).join('\n')
  const content = `BT /F1 12 Tf 72 720 Td\n${textOperations}\nET`
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 5)
  const objects = new Map<number, string>([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`],
    [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [4, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`],
  ])
  for (const id of pageIds) objects.set(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>')

  let body = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let id = 1; id <= pageCount + 4; id += 1) {
    offsets[id] = Buffer.byteLength(body)
    body += `${id} 0 obj\n${objects.get(id)}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${pageCount + 5}\n0000000000 65535 f \n`
  for (let id = 1; id <= pageCount + 4; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${pageCount + 5} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}

describe('guardrails de upload', () => {
  const temporaryDirectories: string[] = []
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  test('rejeita texto extraído acima do teto antes de salvar ou acessar o banco', async () => {
    const pool = new Pool()
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-limit-test')
    const save = spyOn(storage, 'save')
    try {
      await expect(new IngestionService(pool, storage).upload(
        uploadFile('a'.repeat(MAX_MATERIAL_LENGTH + 1)),
        undefined,
        'pt-BR',
        '00000000-0000-4000-8000-000000000001',
      )).rejects.toMatchObject({ statusCode: 413, code: 'MATERIAL_TOO_LARGE' })
      expect(save).not.toHaveBeenCalled()
    } finally {
      save.mockRestore()
      await pool.end()
    }
  })

  test('parser PDF isolado rejeita excesso de páginas antes de extrair texto', async () => {
    await expect(extractPdfText(buildPdf(MAX_PDF_PAGES + 1)))
      .rejects.toMatchObject({ statusCode: 413, code: 'PDF_TOO_MANY_PAGES' })
  })

  test('rollback de banco remove o arquivo e não confirma evento parcial', async () => {
    const statements: string[] = []
    const client = {
      query: async (sql: string) => {
        statements.push(sql)
        if (sql.startsWith('INSERT INTO processing_jobs')) throw new Error('database unavailable')
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined,
    }
    const pool = { connect: async () => client } as unknown as Pool
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-rollback-test')
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt')
    const remove = spyOn(storage, 'remove').mockResolvedValue()

    await expect(new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    )).rejects.toThrow('database unavailable')

    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(statements.some((sql) => sql.includes('activity_events'))).toBe(false)
    expect(remove).toHaveBeenCalledWith('safe-material.txt')
    save.mockRestore()
    remove.mockRestore()
  })

  test('falha ao obter conexão remove o arquivo já salvo', async () => {
    const pool = { connect: async () => { throw new Error('pool unavailable') } } as unknown as Pool
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-connect-test')
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt')
    const remove = spyOn(storage, 'remove').mockResolvedValue()

    await expect(new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    )).rejects.toThrow('pool unavailable')

    expect(remove).toHaveBeenCalledWith('safe-material.txt')
    save.mockRestore()
    remove.mockRestore()
  })

  test('falha no evento transacional executa rollback e remove o arquivo', async () => {
    const statements: string[] = []
    const client = {
      query: async (sql: string) => {
        statements.push(sql)
        if (sql.includes('activity_events')) throw new Error('event insert failed')
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined,
    }
    const pool = { connect: async () => client } as unknown as Pool
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-event-test')
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt')
    const remove = spyOn(storage, 'remove').mockResolvedValue()

    await expect(new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    )).rejects.toThrow('event insert failed')

    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(remove).toHaveBeenCalledWith('safe-material.txt')
    save.mockRestore()
    remove.mockRestore()
  })

  test('COMMIT aplicado mas resposta perdida é reconciliado sem apagar o arquivo', async () => {
    const releases: unknown[] = []
    const client = {
      query: async (sql: string) => {
        if (sql === 'COMMIT') throw new Error('connection lost after commit')
        return { rows: [], rowCount: 1 }
      },
      release: (reason?: unknown) => { releases.push(reason) },
    }
    const pool = {
      connect: async () => client,
      query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }),
    } as unknown as Pool
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-commit-test')
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt')
    const remove = spyOn(storage, 'remove').mockResolvedValue()

    await expect(new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    )).resolves.toMatchObject({ title: 'Material', status: 'PENDING' })

    expect(remove).not.toHaveBeenCalled()
    expect(releases).toEqual([true])
    save.mockRestore()
    remove.mockRestore()
  })

  test('sucesso confirma material, job e evento em uma única transação', async () => {
    const statements: string[] = []
    const client = {
      query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 1 } },
      release: () => undefined,
    }
    const pool = { connect: async () => client } as unknown as Pool
    const storage = new LocalMaterialStorage('/tmp/masterme-ingestion-success-test')
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt')
    const remove = spyOn(storage, 'remove').mockResolvedValue()

    await new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    )

    expect(statements[0]).toBe('BEGIN')
    expect(statements.some((sql) => sql.startsWith('INSERT INTO study_materials'))).toBe(true)
    expect(statements.some((sql) => sql.startsWith('INSERT INTO processing_jobs'))).toBe(true)
    expect(statements.some((sql) => sql.includes('activity_events'))).toBe(true)
    expect(statements.at(-1)).toBe('COMMIT')
    expect(remove).not.toHaveBeenCalled()
    save.mockRestore()
    remove.mockRestore()
  })

  test('storage local remove somente chaves simples dentro do diretório configurado', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'masterme-storage-'))
    temporaryDirectories.push(directory)
    const storage = new LocalMaterialStorage(directory)
    const key = await storage.save('material-id', '../material perigoso.txt', Buffer.from('conteúdo'))
    const path = join(directory, key)
    await access(path)
    await storage.remove(key)
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(storage.remove('../outside.txt')).rejects.toThrow('Chave de storage inválida')
  })
})
