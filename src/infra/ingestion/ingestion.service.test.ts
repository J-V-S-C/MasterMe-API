import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { MAX_MATERIAL_LENGTH } from '../../application/material-limits';
import { makePdf } from '../../../scripts/generate-phase2-pdfs';
import {
  classifyProcessingFailure,
  extractPdfText,
  IngestionService,
  LocalMaterialStorage,
  MAX_PDF_PAGES,
  ProcessingWorker,
} from './ingestion.service';
import { AppError } from '../../application/errors';
import type { MasterMeService } from '../../application/services/masterme.service';

describe('classifyProcessingFailure', () => {
  test('does not retry extraction blocked by credits before the provider', () => {
    expect(
      classifyProcessingFailure(
        new AppError('AI_PERIOD_CREDIT_LIMIT_REACHED',
          'Seu saldo de créditos do período foi atingido.',
        ),
      ),
    ).toEqual({
      retryable: false,
      message: 'Seu saldo de créditos do período foi atingido.',
      code: 'AI_CREDIT_LIMIT_REACHED',
    });
  });
  test('stops retries when the provider daily quota is exhausted', () => {
    const failure = classifyProcessingFailure(
      new Error(
        '429 Too Many Requests: generate_content_free_tier_requests quota exceeded',
      ),
    );
    expect(failure).toEqual({
      retryable: false,
      message:
        'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    });
  });

  test('does not automatically retry permanent extraction failures', () => {
    expect(
      classifyProcessingFailure(new Error('material schema conflict')),
    ).toEqual({
      retryable: false,
      message:
        'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.',
      code: 'EXTRACTION_FAILED',
    });
  });

  test('retries transient Gemini model failures', () => {
    expect(
      classifyProcessingFailure(
        new Error(
          'Gemini quota or availability exhausted for all configured models: gemini-3.5-flash-lite',
        ),
      ),
    ).toEqual({
      retryable: true,
      message:
        'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    });
  });

  test('retries transient network failures', () => {
    expect(
      classifyProcessingFailure(
        new Error('Unable to connect. Is the computer able to access the url?'),
      ),
    ).toEqual({
      retryable: true,
      message:
        'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    });
  });
});

test('worker persists and logs only controlled failure codes, never provider content or IDs', async () => {
  const secret = 'private learner answer and provider key';
  const job = {
    id: '22222222-2222-4222-8222-222222222222',
    material_id: '33333333-3333-4333-8333-333333333333',
    owner_id: '11111111-1111-4111-8111-111111111111',
  };
  const stored: unknown[][] = [];
  const client = {
    query: async (sql: string) => ({ rows: sql.startsWith('SELECT j.id') ? [job] : [] }),
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('last_error=$2')) {
        stored.push(values ?? []);
        return { rows: [{ status: 'FAILED' }] };
      }
      if (sql.startsWith('SELECT 1 FROM processing_jobs')) return { rows: [{ exists: true }] };
      return { rows: [] };
    },
  } as unknown as Pool;
  const study = { extractConcepts: async () => { throw new Error(secret); } } as unknown as MasterMeService;
  const ingestion = { event: async () => undefined } as unknown as IngestionService;
  const log = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(await new ProcessingWorker(pool, study, ingestion).processOnce()).toBe(true);
    expect(stored).toEqual([[job.id, 'EXTRACTION_FAILED', true]]);
    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain('EXTRACTION_FAILED');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(job.id);
    expect(output).not.toContain(job.material_id);
  } finally {
    log.mockRestore();
  }
});

describe('activity events', () => {
  test('persists and notifies the user in the same PostgreSQL statement', async () => {
    const pool = new Pool();
    const query = spyOn(pool, 'query').mockImplementation(async () => ({
      rows: [{ id: 1 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    }));
    try {
      await new IngestionService(
        pool,
        new LocalMaterialStorage('/tmp/masterme-ingestion-test'),
      ).event(
        'session.updated',
        { sessionId: 'session-a' },
        '00000000-0000-4000-8000-000000000001',
      );
      const call = query.mock.calls[0] as unknown as [unknown, unknown[]];
      expect(String(call[0])).toContain("pg_notify('masterme_activity'");
      expect(call[1]).toEqual([
        'session.updated',
        JSON.stringify({ sessionId: 'session-a' }),
        '00000000-0000-4000-8000-000000000001',
      ]);
    } finally {
      query.mockRestore();
      await pool.end();
    }
  });
});

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
});

describe('upload guardrails', () => {
  const temporaryDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test('accepts a text file beyond the pasted-text limit for import', async () => {
    const pool = new Pool();
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-limit-test',
    );
    const save = spyOn(storage, 'save');
    const connect = spyOn(pool, 'connect').mockImplementation(async () => { throw new Error('database unavailable'); });
    try {
      await expect(
        new IngestionService(pool, storage).upload(
          uploadFile('a'.repeat(MAX_MATERIAL_LENGTH + 1)),
          undefined,
          'pt-BR',
          '00000000-0000-4000-8000-000000000001',
        ),
      ).rejects.toThrow('database unavailable');
      expect(save).toHaveBeenCalled();
    } finally {
      save.mockRestore();
      connect.mockRestore();
      await pool.end();
    }
  });

  test('isolated PDF parser rejects excess pages before extracting text', async () => {
    await expect(
      extractPdfText(makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => ({ lines: ['Plain PDF text for testing'] })), false)),
    ).rejects.toMatchObject({ code: 'PDF_TOO_MANY_PAGES' });
  }, 90_000);

  test('PDF at the page limit remains readable within the parser bounds', async () => {
    const text = await extractPdfText(makePdf(Array.from({ length: MAX_PDF_PAGES }, () => ({ lines: ['Plain PDF text for testing'] })), false));
    expect(text).toContain('Plain PDF text for testing');
  }, 90_000);

  test('PDF extraction accepts more than 500,000 characters', async () => {
    const pdf = makePdf(Array.from({ length: 600 }, (_, page) => ({
      lines: Array.from({ length: 10 }, (_, line) =>
        `Section ${page} line ${line} ${'technical content '.repeat(5)}`),
    })), false);
    const text = await extractPdfText(pdf);
    expect(text.length).toBeGreaterThan(MAX_MATERIAL_LENGTH);
  }, 90_000);

  test('database rollback removes the file and does not commit a partial event', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.startsWith('INSERT INTO processing_jobs'))
          throw new Error('database unavailable');
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-rollback-test',
    );
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt');
    const remove = spyOn(storage, 'remove').mockResolvedValue();

    await expect(
      new IngestionService(pool, storage).upload(
        uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
        'Material',
        'pt-BR',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toThrow('database unavailable');

    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(statements.some((sql) => sql.includes('activity_events'))).toBe(
      false,
    );
    expect(remove).toHaveBeenCalledWith('safe-material.txt');
    save.mockRestore();
    remove.mockRestore();
  });

  test('connection acquisition failure removes the already saved file', async () => {
    const pool = {
      connect: async () => {
        throw new Error('pool unavailable');
      },
    } as unknown as Pool;
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-connect-test',
    );
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt');
    const remove = spyOn(storage, 'remove').mockResolvedValue();

    await expect(
      new IngestionService(pool, storage).upload(
        uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
        'Material',
        'pt-BR',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toThrow('pool unavailable');

    expect(remove).toHaveBeenCalledWith('safe-material.txt');
    save.mockRestore();
    remove.mockRestore();
  });

  test('transactional event failure rolls back and removes the file', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('activity_events'))
          throw new Error('event insert failed');
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-event-test',
    );
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt');
    const remove = spyOn(storage, 'remove').mockResolvedValue();

    await expect(
      new IngestionService(pool, storage).upload(
        uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
        'Material',
        'pt-BR',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toThrow('event insert failed');

    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(remove).toHaveBeenCalledWith('safe-material.txt');
    save.mockRestore();
    remove.mockRestore();
  });

  test('committed transaction with lost response is reconciled without deleting the file', async () => {
    const releases: unknown[] = [];
    const client = {
      query: async (sql: string) => {
        if (sql === 'COMMIT') throw new Error('connection lost after commit');
        return { rows: [], rowCount: 1 };
      },
      release: (reason?: unknown) => {
        releases.push(reason);
      },
    };
    const pool = {
      connect: async () => client,
      query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }),
    } as unknown as Pool;
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-commit-test',
    );
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt');
    const remove = spyOn(storage, 'remove').mockResolvedValue();

    await expect(
      new IngestionService(pool, storage).upload(
        uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
        'Material',
        'pt-BR',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).resolves.toMatchObject({ title: 'Material', status: 'PENDING' });

    expect(remove).not.toHaveBeenCalled();
    expect(releases).toEqual([true]);
    save.mockRestore();
    remove.mockRestore();
  });

  test('success commits material, job and event in one transaction', async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const storage = new LocalMaterialStorage(
      '/tmp/masterme-ingestion-success-test',
    );
    const save = spyOn(storage, 'save').mockResolvedValue('safe-material.txt');
    const remove = spyOn(storage, 'remove').mockResolvedValue();

    await new IngestionService(pool, storage).upload(
      uploadFile('Conteúdo válido com tamanho suficiente para o teste.'),
      'Material',
      'pt-BR',
      '00000000-0000-4000-8000-000000000001',
    );

    expect(statements[0]).toBe('BEGIN');
    expect(
      statements.some((sql) => sql.startsWith('INSERT INTO study_materials')),
    ).toBe(true);
    expect(
      statements.some((sql) => sql.startsWith('INSERT INTO processing_jobs')),
    ).toBe(true);
    expect(statements.some((sql) => sql.includes('activity_events'))).toBe(
      true,
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(remove).not.toHaveBeenCalled();
    save.mockRestore();
    remove.mockRestore();
  });

  test('local storage removes only simple keys within the configured directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'masterme-storage-'));
    temporaryDirectories.push(directory);
    const storage = new LocalMaterialStorage(directory);
    const key = await storage.save(
      'material-id',
      '../material perigoso.txt',
      Buffer.from('conteúdo'),
    );
    const path = join(directory, key);
    await access(path);
    await storage.remove(key);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.remove('../outside.txt')).rejects.toThrow(
      'Invalid storage key',
    );
  });
});
