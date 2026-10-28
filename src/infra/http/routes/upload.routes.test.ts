import { describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { IngestionService } from '../../ingestion/ingestion.service';
import type { MasterMeService } from '../../../application/services/masterme.service';
import { createApp } from '../../../../server';
import { MasterMeController, IngestionController } from '../../controllers/masterme.controller';
import { testSecurity } from './test-security';

const withUploadServer = async (
  run: (baseUrl: string) => Promise<void>,
  deleteMaterial: (id: string, ownerId: string) => Promise<void> = async () => {},
  originalPdf: (id: string, ownerId: string) => Promise<Buffer> = async () => { throw new Error('PDF should not be read'); },
): Promise<void> => {
  const study = {} as MasterMeService;
  const ingestion = {
    deleteMaterial,
    originalPdf,
    upload: async () => {
      throw new Error('Upload should not be called');
    },
  } as unknown as IngestionService;
  const server: Server = createApp({ study: new MasterMeController(study, 100, ingestion), ingestion: new IngestionController(ingestion), security: testSecurity }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test port is unavailable.');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

describe('multipart upload guardrails', () => {
  test('rejects files over 16 MiB before reaching the service', async () => {
    await withUploadServer(async (baseUrl) => {
      const form = new FormData();
      form.set(
        'file',
        new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: 'text/plain' }),
        'large.txt',
      );
      const response = await fetch(`${baseUrl}/api/materials/upload`, {
        method: 'POST',
        body: form,
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
    });
  });

  test('rejects excess multipart fields and missing files as client errors', async () => {
    await withUploadServer(async (baseUrl) => {
      const excess = new FormData();
      excess.set(
        'file',
        new Blob(['conteúdo suficiente para upload'], { type: 'text/plain' }),
        'material.txt',
      );
      excess.set('title', 'Material');
      excess.set('locale', 'pt-BR');
      excess.set('extra', 'não permitido');
      const excessResponse = await fetch(`${baseUrl}/api/materials/upload`, {
        method: 'POST',
        body: excess,
      });
      expect(excessResponse.status).toBe(400);
      expect(await excessResponse.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      const missing = new FormData();
      missing.set('title', 'Sem arquivo');
      const missingResponse = await fetch(`${baseUrl}/api/materials/upload`, {
        method: 'POST',
        body: missing,
      });
      expect(missingResponse.status).toBe(400);
      expect(await missingResponse.json()).toMatchObject({
        code: 'INVALID_UPLOAD',
      });
    });
  });
});

test('original PDF route validates the id and serves only the requested PDF bytes', async () => {
  const requested: string[] = [];
  const bytes = Buffer.from('%PDF-1.4\nsource');
  await withUploadServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/materials/not-a-uuid/file`);
    expect(invalid.status).toBe(400);
    const valid = await fetch(`${baseUrl}/api/materials/22222222-2222-4222-8222-222222222222/file`);
    expect(valid.status).toBe(200);
    expect(valid.headers.get('content-type')).toContain('application/pdf');
    expect(valid.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await valid.arrayBuffer())).toEqual(bytes);
    expect(requested).toEqual(['22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111']);
  }, undefined, async (id, ownerId) => { requested.push(`${id}:${ownerId}`); return bytes; });
});


test('material deletion validates the id and returns no content', async () => {
  const deleted: string[] = [];
  await withUploadServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/materials/not-a-uuid`, { method: 'DELETE' });
    expect(invalid.status).toBe(400);
    const valid = await fetch(`${baseUrl}/api/materials/11111111-1111-4111-8111-111111111111`, { method: 'DELETE' });
    expect(valid.status).toBe(204);
    expect(deleted).toEqual(['11111111-1111-4111-8111-111111111111']);
  }, async (id) => { deleted.push(id); });
});
