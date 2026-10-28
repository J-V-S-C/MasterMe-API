import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { MasterMeService } from '../../application/services/masterme.service';
import { AppError, ConflictError, NotFoundError } from '../../application/errors';
import { withAiUsageOwner } from '../context/ai-usage-context';
import type { MaterialKind, SupportedLocale } from '../../application/domain/material';
import { ActivityEventHub } from '../events/activity-event-hub';
import {
  deriveEditorialUnits,
  type EditorialUnit,
} from '../parsers/editorial-structure';
import { extractPdfDocument, MAX_PDF_PAGES } from '../parsers/poppler-pdf';
export { extractPdfDocument, MAX_PDF_PAGES };

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const allowed = new Map([
  ['application/pdf', 'PDF'],
  ['text/plain', 'TXT'],
  ['text/markdown', 'MARKDOWN'],
  ['text/x-markdown', 'MARKDOWN'],
]);

export type ProcessingFailure = {
  retryable: boolean;
  message: string;
  code: 'AI_QUOTA_EXHAUSTED' | 'AI_CREDIT_LIMIT_REACHED' | 'EXTRACTION_FAILED';
};

export const classifyProcessingFailure = (
  error: unknown,
): ProcessingFailure => {
  if (
    error instanceof AppError &&
    [
      'AI_DISABLED',
      'AI_GLOBAL_LIMIT_REACHED',
      'AI_DAILY_CREDIT_LIMIT_REACHED',
      'AI_PERIOD_CREDIT_LIMIT_REACHED',
    ].includes(error.code)
  )
    return {
      retryable: false,
      message: error.message,
      code: 'AI_CREDIT_LIMIT_REACHED',
    };
  const details = String(error).toLowerCase();
  const quotaExhausted =
    details.includes('quota exceeded') ||
    details.includes('free_tier_requests');
  if (quotaExhausted)
    return {
      retryable: false,
      message:
        'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
      code: 'AI_QUOTA_EXHAUSTED',
    };
  if (
    details.includes('availability exhausted') ||
    details.includes('503') ||
    details.includes('expected object, received null')
  )
    return {
      retryable: true,
      message:
        'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    };
  if (
    details.includes('unable to connect') ||
    details.includes('fetch failed') ||
    details.includes('network')
  )
    return {
      retryable: true,
      message:
        'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
      code: 'EXTRACTION_FAILED',
    };
  return {
    retryable: false,
    message:
      'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.',
    code: 'EXTRACTION_FAILED',
  };
};

const processingFailureDiagnostic = (error: unknown): Record<string, string | number> => {
  const details = String(error).toLowerCase();
  const reason = error instanceof AppError && [
    'AI_DISABLED', 'AI_GLOBAL_LIMIT_REACHED', 'AI_DAILY_CREDIT_LIMIT_REACHED',
    'AI_PERIOD_CREDIT_LIMIT_REACHED',
  ].includes(error.code) ? 'credit_limit'
    : details.includes('quota exceeded') || details.includes('free_tier_requests') ? 'provider_quota'
    : details.includes('availability exhausted') || details.includes('503') || details.includes('expected object, received null') ? 'provider_unavailable_or_invalid_response'
    : details.includes('unable to connect') || details.includes('fetch failed') || details.includes('network') ? 'network'
    : error instanceof AppError ? 'application_error' : 'unexpected_error';
  const diagnostic: Record<string, string | number> = { reason };
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)) diagnostic.errorType = error.name;
  if (error instanceof AppError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) diagnostic.appCode = error.code;
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) diagnostic.httpStatus = status;
    if (!(error instanceof AppError) && typeof candidate.code === 'string' && /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)$/.test(candidate.code)) diagnostic.systemCode = candidate.code;
  }
  const source = error instanceof Error ? error.stack?.match(/\/app\/src\/[a-zA-Z0-9_./-]+\.ts:\d+:\d+/)?.[0] : undefined;
  if (source) diagnostic.source = source;
  return diagnostic;
};

/** Local volume storage for the single-VM deployment; the volume requires backup. */
export class LocalMaterialStorage {
  public constructor(private readonly directory: string) {}
  public async save(
    id: string,
    filename: string,
    data: Buffer,
  ): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const key = `${id}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      await writeFile(join(this.directory, key), data);
      return key;
    } catch (error: unknown) {
      try {
        await this.remove(key);
      } catch {
        /* preservar erro de escrita */
      }
      throw error;
    }
  }
  public async remove(key: string): Promise<void> {
    if (basename(key) !== key) throw new Error('Invalid storage key.');
    try {
      await unlink(join(this.directory, key));
    } catch (error: unknown) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
  }
  public async read(key: string): Promise<Buffer> {
    if (basename(key) !== key) throw new Error('Invalid storage key.');
    return readFile(join(this.directory, key));
  }
}

export const extractPdfText = async (data: Buffer): Promise<string> =>
  (await extractPdfDocument(data)).text;

const textFromFile = async (
  mime: string,
  data: Buffer,
): Promise<{ text: string; units: EditorialUnit[] }> => {
  if (mime !== 'application/pdf') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data).trim();
    return {
      text,
      units: deriveEditorialUnits(
        text,
        mime === 'text/markdown' || mime === 'text/x-markdown'
          ? 'MARKDOWN'
          : 'TXT',
      ),
    };
  }
  return extractPdfDocument(data);
};

export class IngestionService {
  public constructor(
    private readonly pool: Pool,
    private readonly storage: LocalMaterialStorage,
    private readonly eventHub = new ActivityEventHub(pool),
  ) {}
  public async originalPdf(materialId: string, ownerId: string): Promise<Buffer> {
    const result = await this.pool.query<{ storage_key: string | null; mime_type: string | null }>(
      'SELECT storage_key,mime_type FROM study_materials WHERE id=$1 AND owner_id=$2',
      [materialId, ownerId],
    );
    const file = result.rows[0];
    if (!file || file.mime_type !== 'application/pdf' || !file.storage_key) throw new NotFoundError('PDF');
    try {
      return await this.storage.read(file.storage_key);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new NotFoundError('PDF');
      throw error;
    }
  }
  public async upload(
    file: Express.Multer.File,
    title: string | undefined,
    locale: SupportedLocale,
    ownerId: string,
    requestedKind?: MaterialKind,
  ): Promise<{ id: string; title: string; status: string }> {
    const kind = allowed.get(file.mimetype);
    if (!kind)
      throw new AppError('INVALID_FILE',
        'Envie um PDF, Markdown ou TXT válido.',
      );
    if (file.size > MAX_UPLOAD_BYTES)
      throw new AppError('UPLOAD_TOO_LARGE',
        'Envie um arquivo de até 16 MiB.',
      );
    let parsed: { text: string; units: EditorialUnit[] };
    try {
      parsed = await textFromFile(file.mimetype, file.buffer);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_FILE',
        'Não foi possível ler o arquivo. PDFs escaneados sem texto não são suportados.',
      );
    }
    const content = parsed.text;
    if (content.length < 20)
      throw new AppError('INVALID_FILE',
        'O arquivo não possui texto legível suficiente. Envie um PDF com camada de texto.',
      );
    const materialKind: MaterialKind = requestedKind ?? (
      parsed.units.filter((unit) => unit.level === 1 && unit.title).length >= 2
        ? 'BOOK'
        : kind === 'TXT' ? 'TEXT' : 'ARTICLE'
    );
    const id = randomUUID();
    const storageKey = await this.storage.save(
      id,
      file.originalname,
      file.buffer,
    );
    const requestedTitle =
      title?.trim() ||
      file.originalname.replace(/\.[^.]+$/, '').trim() ||
      'Material importado';
    const materialTitle = requestedTitle.slice(0, 160);
    let client: PoolClient | undefined;
    let commitAttempted = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO study_materials (id,title,content,locale,created_at,source_type,original_filename,mime_type,storage_key,processing_status,owner_id,material_kind) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          materialTitle,
          content,
          locale,
          kind,
          file.originalname,
          file.mimetype,
          storageKey,
          'PENDING',
          ownerId,
          materialKind,
        ],
      );
      for (const unit of parsed.units)
        await client.query(
          'INSERT INTO material_units (id,material_id,ordinal,title,level,start_offset,end_offset,provenance,page_number,original_title,original_ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            randomUUID(),
            id,
            unit.order,
            unit.title,
            unit.level,
            unit.startOffset,
            unit.endOffset,
            unit.provenance,
            unit.pageNumber ?? null,
            unit.title,
            unit.order,
          ],
        );
      const jobId = randomUUID();
      await client.query(
        'INSERT INTO processing_jobs (id,material_id,type) VALUES ($1,$2,$3)',
        [jobId, id, 'EXTRACT'],
      );
      await client.query(
        "WITH inserted AS (INSERT INTO activity_events (type,payload,owner_id) VALUES ($1,$2,$3) RETURNING id) SELECT id,pg_notify('masterme_activity',$3::text) FROM inserted",
        ['material.queued', JSON.stringify({ materialId: id, jobId }), ownerId],
      );
      commitAttempted = true;
      await client.query('COMMIT');
      return { id, title: materialTitle, status: 'PENDING' };
    } catch (error: unknown) {
      if (commitAttempted) {
        // A COMMIT error leaves the connection in an unknown state. Discard it
        // before reconciling through another connection to avoid exhausting small pools.
        client?.release(true);
        client = undefined;
        try {
          const confirmed = await this.pool.query(
            'SELECT 1 FROM study_materials WHERE id=$1',
            [id],
          );
          if (confirmed.rows[0])
            return { id, title: materialTitle, status: 'PENDING' };
        } catch {
          console.error(
            JSON.stringify({
              level: 'error',
              operation: 'upload-commit-reconciliation',
              code: 'COMMIT_STATUS_UNKNOWN',
            }),
          );
          throw new AppError('UPLOAD_COMMIT_UNKNOWN',
            'Não foi possível confirmar o upload. Tente consultar seus materiais antes de reenviar.',
          );
        }
      } else if (client)
        try {
          await client.query('ROLLBACK');
        } catch {
          /* preservar erro original */
        }
      try {
        await this.storage.remove(storageKey);
      } catch {
        console.error(
          JSON.stringify({
            level: 'error',
            operation: 'upload-cleanup',
            code: 'STORAGE_REMOVE_FAILED',
          }),
        );
      }
      throw error;
    } finally {
      client?.release();
    }
  }
  public async deleteMaterial(materialId: string, ownerId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<{ storage_key: string | null }>(
        'SELECT storage_key FROM study_materials WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [materialId, ownerId],
      );
      if (!owned.rows[0]) throw new NotFoundError('Material');
      const active = await client.query(
        "SELECT 1 FROM processing_jobs WHERE material_id=$1 AND status IN ('PENDING','PROCESSING') LIMIT 1",
        [materialId],
      );
      if (active.rows[0]) throw new ConflictError('Cancele a extração antes de apagar o material.');
      const storageKey = owned.rows[0].storage_key;
      if (storageKey) await client.query(
        'INSERT INTO material_file_deletions (material_id,storage_key) VALUES ($1,$2)',
        [materialId, storageKey],
      );
      await client.query('DELETE FROM study_materials WHERE id=$1 AND owner_id=$2', [materialId, ownerId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    try {
      await this.event('material.deleted', { materialId }, ownerId);
    } catch {
      console.error(JSON.stringify({ level: 'error', operation: 'publish-material-deleted', code: 'ACTIVITY_PUBLISH_FAILED' }));
    }
  }

  public async cleanupDeletedFileOnce(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<{ material_id: string; storage_key: string }>(
        'SELECT material_id,storage_key FROM material_file_deletions WHERE run_after<=now() ORDER BY run_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1',
      );
      const file = pending.rows[0];
      if (!file) {
        await client.query('COMMIT');
        return false;
      }
      try {
        await this.storage.remove(file.storage_key);
      } catch {
        await client.query(
          "UPDATE material_file_deletions SET attempts=attempts+1,run_after=now()+least(3600,power(2,least(attempts,10))*5)::int*interval '1 second' WHERE material_id=$1",
          [file.material_id],
        );
        await client.query('COMMIT');
        return false;
      }
      await client.query('DELETE FROM material_file_deletions WHERE material_id=$1', [file.material_id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async enqueue(materialId: string, ownerId: string): Promise<object> {
    await this.status(materialId, ownerId);
    const active = await this.pool.query(
      "SELECT id,stage,progress_percent AS \"progressPercent\" FROM processing_jobs WHERE material_id=$1 AND type='EXTRACT' AND status IN ('PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1",
      [materialId],
    );
    if (active.rows[0]) return active.rows[0] as object;
    const resumed = await this.pool.query<{ id: string; stage: string; progressPercent: number }>(
      `UPDATE processing_jobs SET status='PENDING',stage='RETRYING',attempts=0,run_after=now(),locked_at=NULL,finished_at=NULL,last_error=NULL,updated_at=now()
       WHERE id=(SELECT j.id FROM processing_jobs j JOIN study_materials m ON m.id=j.material_id
         WHERE j.material_id=$1 AND m.owner_id=$2 AND m.material_kind='BOOK' AND j.type='EXTRACT' AND j.status='FAILED'
           AND j.id=(SELECT id FROM processing_jobs WHERE material_id=$1 AND type='EXTRACT' ORDER BY created_at DESC LIMIT 1)
           AND EXISTS(SELECT 1 FROM processing_job_units u WHERE u.job_id=j.id)
         LIMIT 1)
       RETURNING id,stage,progress_percent AS "progressPercent"`,
      [materialId, ownerId],
    );
    if (resumed.rows[0]) {
      await this.pool.query("UPDATE study_materials SET processing_status='PENDING',processing_error=NULL WHERE id=$1 AND owner_id=$2", [materialId, ownerId]);
      await this.event('material.queued', { materialId, jobId: resumed.rows[0].id, stage: 'RETRYING', progressPercent: resumed.rows[0].progressPercent }, ownerId);
      return resumed.rows[0];
    }
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO processing_jobs (id,material_id,type,stage) VALUES ($1,$2,'EXTRACT','QUEUED')",
      [id, materialId],
    );
    await this.pool.query(
      "UPDATE study_materials SET processing_status='PENDING',processing_error=NULL WHERE id=$1",
      [materialId],
    );
    await this.event(
      'material.queued',
      { materialId, jobId: id, stage: 'QUEUED', progressPercent: 0 },
      ownerId,
    );
    return { id, stage: 'QUEUED', progressPercent: 0 };
  }
  public async cancel(materialId: string, ownerId: string): Promise<object> {
    await this.status(materialId, ownerId);
    const result = await this.pool.query(
      "UPDATE processing_jobs SET status='CANCELLED',finished_at=now(),locked_at=NULL,updated_at=now() WHERE id=(SELECT id FROM processing_jobs WHERE material_id=$1 AND type='EXTRACT' AND status IN ('PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1) RETURNING id",
      [materialId],
    );
    if (!result.rows[0])
      throw new AppError('EXTRACTION_NOT_ACTIVE',
        'Não há extração ativa para cancelar.',
      );
    await this.pool.query(
      "UPDATE study_materials SET processing_status='CANCELLED',processing_error=NULL WHERE id=$1",
      [materialId],
    );
    await this.event(
      'material.cancelled',
      { materialId, jobId: result.rows[0].id },
      ownerId,
    );
    return { id: result.rows[0].id, status: 'CANCELLED' };
  }
  public async status(id: string, ownerId: string): Promise<object> {
    const result = await this.pool.query(
      'SELECT m.id,m.processing_status AS status,m.processing_error AS error,m.processed_at AS "processedAt",m.active_extraction_job_id AS "activeExtractionJobId",j.id AS "jobId",j.stage,j.total_chunks AS "totalChunks",j.completed_chunks AS "completedChunks",j.progress_percent AS "progressPercent",j.attempts,j.started_at AS "startedAt",j.finished_at AS "finishedAt" FROM study_materials m LEFT JOIN LATERAL (SELECT * FROM processing_jobs WHERE material_id=m.id ORDER BY created_at DESC LIMIT 1) j ON true WHERE m.id=$1 AND m.owner_id=$2',
      [id, ownerId],
    );
    if (!result.rows[0]) throw new NotFoundError('Material');
    return result.rows[0] as object;
  }
  public async event(
    type: string,
    payload: object,
    ownerId: string,
  ): Promise<void> {
    await this.pool.query(
      "WITH inserted AS (INSERT INTO activity_events (type,payload,owner_id) VALUES ($1,$2,$3) RETURNING id) SELECT id,pg_notify('masterme_activity',$3::text) FROM inserted",
      [type, JSON.stringify(payload), ownerId],
    );
  }
  public subscribe(ownerId: string, listener: () => void): Promise<() => void> {
    return this.eventHub.subscribe(ownerId, listener);
  }
  public async events(
    after: number,
    ownerId: string,
  ): Promise<Array<{ id: string; type: string; payload: object }>> {
    const result = await this.pool.query(
      'SELECT id,type,payload FROM activity_events WHERE id > $1 AND owner_id=$2 ORDER BY id ASC LIMIT 100',
      [after, ownerId],
    );
    return result.rows as Array<{ id: string; type: string; payload: object }>;
  }
  public async latestEventId(ownerId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT COALESCE(MAX(id), 0)::int AS id FROM activity_events WHERE owner_id=$1',
      [ownerId],
    );
    return Number(result.rows[0]?.id ?? 0);
  }
  public async overview(ownerId: string): Promise<object> {
    const result = await this.pool.query(
      'SELECT j.status,count(*)::int AS count FROM processing_jobs j JOIN study_materials m ON m.id=j.material_id WHERE m.owner_id=$1 GROUP BY j.status',
      [ownerId],
    );
    const oldest = await this.pool.query(
      "SELECT j.material_id,j.created_at FROM processing_jobs j JOIN study_materials m ON m.id=j.material_id WHERE j.status='PROCESSING' AND m.owner_id=$1 ORDER BY j.created_at LIMIT 1",
      [ownerId],
    );
    return { jobs: result.rows, oldestProcessing: oldest.rows[0] ?? null };
  }
}

export class ProcessingWorker {
  public constructor(
    private readonly pool: Pool,
    private readonly study: MasterMeService,
    private readonly ingestion: IngestionService,
  ) {}
  public async processOnce(): Promise<boolean> {
    const client = await this.pool.connect();
    let job: { id: string; material_id: string; owner_id: string; material_kind: string | null; attempts?: number } | undefined;
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE processing_jobs SET status='PENDING',stage='RETRYING',locked_at=NULL WHERE status='PROCESSING' AND locked_at < now() - interval '5 minutes'",
      );
      const result = await client.query(
          "SELECT j.id,j.material_id,j.attempts,m.owner_id,m.material_kind FROM processing_jobs j JOIN study_materials m ON m.id=j.material_id WHERE j.status='PENDING' AND run_after<=now() ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      job = result.rows[0] as typeof job;
      if (job)
        await client.query(
          "UPDATE processing_jobs SET status='PROCESSING',stage='PREPARING',attempts=attempts+1,locked_at=now(),started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1",
          [job.id],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!job) return false;
    let stage = 'PREPARING';
    // Renove o lease durante chamadas longas para impedir que o mesmo job seja
    // retomado em paralelo como se este worker tivesse morrido.
    const heartbeat = setInterval(() => {
      void this.pool
        .query(
          "UPDATE processing_jobs SET locked_at=now(),updated_at=now() WHERE id=$1 AND status='PROCESSING'",
          [job!.id],
        )
        .catch(() =>
          console.warn(
            JSON.stringify({
              level: 'warn',
              operation: 'processing-heartbeat',
              code: 'HEARTBEAT_FAILED',
            }),
          ),
        );
    }, 60_000);
    await this.pool.query(
      "UPDATE study_materials SET processing_status='PROCESSING' WHERE id=$1",
      [job.material_id],
    );
    await this.ingestion.event(
      'material.progress',
      { materialId: job.material_id, stage: 'PREPARING', progressPercent: 1 },
      job.owner_id,
    );
    try {
      const bookUnits = job.material_kind === 'BOOK'
        ? await this.pool.query<{ id: string; start_offset: number; end_offset: number }>(
          `SELECT id,start_offset,end_offset FROM material_units
           WHERE material_id=$1 AND title IS NOT NULL AND provenance<>'UNSTRUCTURED'
             AND level=(SELECT MIN(level) FROM material_units WHERE material_id=$1 AND title IS NOT NULL AND provenance<>'UNSTRUCTURED')
           ORDER BY ordinal`,
          [job.material_id],
        ) : null;
      const units = bookUnits?.rows ?? [];
      const sourceEnds = new Map<string, number>();
      if (units.length) {
        const material = await this.study.getMaterial(job.material_id);
        const sourceOrder = [...units].sort((left, right) => left.start_offset - right.start_offset);
        for (const [index, unit] of sourceOrder.entries()) sourceEnds.set(unit.id, sourceOrder[index + 1]?.start_offset ?? material.content.length);
      }
      const report = async (progress: { stage: 'PREPARING' | 'EXTRACTING' | 'REDUCING'; totalChunks: number; completedChunks: number }, unitIndex?: number) => {
        stage = progress.stage;
        const total = units.length || progress.totalChunks;
        const completed = unitIndex === undefined ? progress.completedChunks : unitIndex;
        const percent = unitIndex === undefined && progress.stage === 'REDUCING' ? 90
          : Math.max(1, Math.round((completed / Math.max(total, 1)) * 85));
        const updated = await this.pool.query(
          "UPDATE processing_jobs SET stage=$2,total_chunks=$3,completed_chunks=$4,progress_percent=$5,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING id",
          [job!.id, progress.stage, total, completed, percent],
        );
        if (!updated.rows[0]) throw new ConflictError('A extração foi cancelada.');
        await this.ingestion.event('material.progress', {
          materialId: job!.material_id, stage: progress.stage,
          totalChunks: total, completedChunks: completed, progressPercent: percent,
        }, job!.owner_id);
      };
      if (units.length) {
        const done = await this.pool.query<{ unit_id: string }>(
          'SELECT unit_id FROM processing_job_units WHERE job_id=$1', [job.id],
        );
        const completed = new Set(done.rows.map((row) => row.unit_id));
        for (const [index, unit] of units.entries()) {
          if (completed.has(unit.id)) continue;
          const endOffset = sourceEnds.get(unit.id);
          if (endOffset === undefined || endOffset <= unit.start_offset) throw new ConflictError('O capítulo não possui trecho legível.');
          await withAiUsageOwner(job.owner_id, () => this.study.extractConcepts(
            job!.material_id,
            async (progress) => report(progress, index),
            async () => this.isActive(job!.id),
            job!.id,
            { id: unit.id, startOffset: unit.start_offset, endOffset },
          ));
          await report({ stage: 'EXTRACTING', totalChunks: units.length, completedChunks: index + 1 }, index + 1);
        }
        const finish = await this.pool.connect();
        try {
          await finish.query('BEGIN');
          const active = await finish.query("SELECT 1 FROM processing_jobs WHERE id=$1 AND status='PROCESSING' FOR UPDATE", [job.id]);
          if (!active.rows[0]) throw new ConflictError('A extração foi cancelada.');
          await finish.query("UPDATE processing_jobs SET status='DONE',stage='READY',progress_percent=100,completed_chunks=$2,total_chunks=$2,finished_at=now(),updated_at=now() WHERE id=$1", [job.id, units.length]);
          await finish.query("UPDATE study_materials SET active_extraction_job_id=$2,processing_status='READY',processed_at=now(),processing_error=NULL WHERE id=$1", [job.material_id, job.id]);
          await finish.query('COMMIT');
        } catch (error) { await finish.query('ROLLBACK'); throw error; }
        finally { finish.release(); }
      } else {
        await withAiUsageOwner(job.owner_id, () => this.study.extractConcepts(
          job!.material_id, report, async () => this.isActive(job!.id), job!.id,
        ));
      }
      await this.ingestion.event(
        'material.ready',
        { materialId: job.material_id, stage: 'READY', progressPercent: 100 },
        job.owner_id,
      );
    } catch (error) {
      if (!(await this.isActive(job.id))) return true;
      const failure = classifyProcessingFailure(error);
      const retried = await this.pool.query(
        "UPDATE processing_jobs SET status=CASE WHEN $3::boolean OR attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,run_after=now()+interval '30 seconds',last_error=$2,updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING status",
        [job.id, failure.code, !failure.retryable],
      );
      const status =
        retried.rows[0]?.status === 'FAILED' ? 'FAILED' : 'PENDING';
      await this.pool.query(
        'UPDATE study_materials SET processing_status=$2,processing_error=$3 WHERE id=$1',
        [job.material_id, status, failure.message],
      );
      console.error(
        JSON.stringify({
          level: 'error',
          operation: 'extract-material',
          code: failure.code,
          stage,
          attempt: typeof job.attempts === 'number' ? job.attempts + 1 : undefined,
          retryable: failure.retryable,
          nextStatus: status,
          ...processingFailureDiagnostic(error),
        }),
      );
      await this.ingestion.event(
        status === 'FAILED' ? 'material.failed' : 'material.queued',
        {
          materialId: job.material_id,
          message: failure.message,
          code: failure.code,
        },
        job.owner_id,
      );
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  private async isActive(jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM processing_jobs WHERE id=$1 AND status='PROCESSING'",
      [jobId],
    );
    return Boolean(result.rows[0]);
  }
}
