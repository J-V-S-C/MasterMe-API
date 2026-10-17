import { describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { IngestionService } from '../../ingestion/ingestion.service';
import type { MasterMeService } from '../../../application/services/masterme.service';
import { createApp } from '../../../../server';
import { MasterMeController, IngestionController } from '../../controllers/masterme.controller';
import { testSecurity } from './test-security';

const withUploadServer = async (
  run: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const study = {} as MasterMeService;
  const ingestion = {
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
  test('rejects files over 8 MiB before reaching the service', async () => {
    await withUploadServer(async (baseUrl) => {
      const form = new FormData();
      form.set(
        'file',
        new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'text/plain' }),
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
        code: 'INVALID_UPLOAD',
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
