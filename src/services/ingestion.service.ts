import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFParse } from 'pdf-parse'
import type { Pool } from 'pg'
import type { MasterMeService } from './masterme.service'
import { AppError, NotFoundError } from './errors'

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const allowed = new Map([['application/pdf', 'PDF'], ['text/plain', 'TXT'], ['text/markdown', 'MARKDOWN'], ['text/x-markdown', 'MARKDOWN']])

export type ProcessingFailure = { retryable: boolean; message: string; code: 'AI_QUOTA_EXHAUSTED' | 'EXTRACTION_FAILED' }

export const classifyProcessingFailure = (error: unknown): ProcessingFailure => {
  const details = String(error).toLowerCase()
  const quotaExhausted = details.includes('quota exceeded') || details.includes('free_tier_requests')
  if (quotaExhausted) return {
    retryable: false,
    message: 'O limite diário do provedor de IA foi atingido. Aguarde a renovação da cota ou revise a configuração da API.',
    code: 'AI_QUOTA_EXHAUSTED',
  }
  if (details.includes('availability exhausted') || details.includes('503') || details.includes('expected object, received null')) return {
    retryable: true,
    message: 'Os modelos Gemini estão indisponíveis ou retornaram uma resposta inválida. Tentaremos novamente em breve.',
    code: 'EXTRACTION_FAILED',
  }
  if (details.includes('unable to connect') || details.includes('fetch failed') || details.includes('network')) return {
    retryable: true,
    message: 'A conexão com o provedor de IA foi interrompida. Tentaremos novamente em breve.',
    code: 'EXTRACTION_FAILED',
  }
  return { retryable: false, message: 'Não foi possível extrair os conceitos deste material. Revise o erro e tente novamente manualmente.', code: 'EXTRACTION_FAILED' }
}

/** Temporary MVP storage. Replace this adapter with object storage before production or multi-instance deployment. */
export class LocalMaterialStorage {
  public constructor(private readonly directory: string) {}
  public async save(id: string, filename: string, data: Buffer): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    const key = `${id}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    await writeFile(join(this.directory, key), data)
    return key
  }
}

const textFromFile = async (mime: string, data: Buffer): Promise<string> => {
  if (mime !== 'application/pdf') return new TextDecoder('utf-8', { fatal: true }).decode(data).trim()
  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new AppError(400, 'INVALID_FILE', 'O arquivo PDF é inválido.')
  const parser = new PDFParse({ data })
  try { return (await parser.getText()).text.trim() } finally { await parser.destroy() }
}

export class IngestionService {
  public constructor(private readonly pool: Pool, private readonly storage: LocalMaterialStorage) {}
  public async upload(file: Express.Multer.File, title?: string): Promise<{ id: string; title: string; status: string }> {
    const kind = allowed.get(file.mimetype)
    if (!kind || file.size > MAX_UPLOAD_BYTES) throw new AppError(400, 'INVALID_FILE', 'Envie um PDF, Markdown ou TXT de até 15 MiB.')
    let content: string
    try { content = await textFromFile(file.mimetype, file.buffer) } catch { throw new AppError(400, 'INVALID_FILE', 'Não foi possível ler o arquivo. PDFs escaneados sem texto não são suportados.') }
    if (content.length < 20) throw new AppError(400, 'INVALID_FILE', 'O arquivo não possui texto legível suficiente. Envie um PDF com camada de texto.')
    const id = randomUUID(); const storageKey = await this.storage.save(id, file.originalname, file.buffer)
    const materialTitle = title?.trim() || file.originalname.replace(/\.[^.]+$/, '') || 'Material importado'
    await this.pool.query('INSERT INTO study_materials (id,title,content,created_at,source_type,original_filename,mime_type,storage_key,processing_status) VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8)', [id, materialTitle, content, kind, file.originalname, file.mimetype, storageKey, 'PENDING'])
    await this.pool.query('INSERT INTO processing_jobs (id,material_id,type) VALUES ($1,$2,$3)', [randomUUID(), id, 'EXTRACT'])
    await this.event('material.queued', { materialId: id })
    return { id, title: materialTitle, status: 'PENDING' }
  }
  public async enqueue(materialId: string): Promise<object> {
    await this.status(materialId)
    const active = await this.pool.query("SELECT id,stage,progress_percent AS \"progressPercent\" FROM processing_jobs WHERE material_id=$1 AND type='EXTRACT' AND status IN ('PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1", [materialId])
    if (active.rows[0]) return active.rows[0] as object
    const id = randomUUID(); await this.pool.query("INSERT INTO processing_jobs (id,material_id,type,stage) VALUES ($1,$2,'EXTRACT','QUEUED')", [id, materialId]); await this.pool.query("UPDATE study_materials SET processing_status='PENDING',processing_error=NULL WHERE id=$1", [materialId]); await this.event('material.queued', { materialId, jobId: id, stage: 'QUEUED', progressPercent: 0 }); return { id, stage: 'QUEUED', progressPercent: 0 }
  }
  public async cancel(materialId: string): Promise<object> {
    await this.status(materialId)
    const result = await this.pool.query("UPDATE processing_jobs SET status='CANCELLED',finished_at=now(),locked_at=NULL,updated_at=now() WHERE id=(SELECT id FROM processing_jobs WHERE material_id=$1 AND type='EXTRACT' AND status IN ('PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1) RETURNING id", [materialId])
    if (!result.rows[0]) throw new AppError(409, 'EXTRACTION_NOT_ACTIVE', 'Não há extração ativa para cancelar.')
    await this.pool.query("UPDATE study_materials SET processing_status='CANCELLED',processing_error=NULL WHERE id=$1", [materialId])
    await this.event('material.cancelled', { materialId, jobId: result.rows[0].id })
    return { id: result.rows[0].id, status: 'CANCELLED' }
  }
  public async status(id: string): Promise<object> { const result = await this.pool.query("SELECT m.id,m.processing_status AS status,m.processing_error AS error,m.processed_at AS \"processedAt\",j.id AS \"jobId\",j.stage,j.total_chunks AS \"totalChunks\",j.completed_chunks AS \"completedChunks\",j.progress_percent AS \"progressPercent\",j.attempts,j.started_at AS \"startedAt\",j.finished_at AS \"finishedAt\" FROM study_materials m LEFT JOIN LATERAL (SELECT * FROM processing_jobs WHERE material_id=m.id ORDER BY created_at DESC LIMIT 1) j ON true WHERE m.id=$1", [id]); if (!result.rows[0]) throw new NotFoundError('Material'); return result.rows[0] as object }
  public async event(type: string, payload: object): Promise<void> { await this.pool.query('INSERT INTO activity_events (type,payload) VALUES ($1,$2)', [type, JSON.stringify(payload)]) }
  public async events(after: number): Promise<Array<{ id: string; type: string; payload: object }>> { const result = await this.pool.query('SELECT id,type,payload FROM activity_events WHERE id > $1 ORDER BY id ASC LIMIT 100', [after]); return result.rows as Array<{ id: string; type: string; payload: object }> }
  public async latestEventId(): Promise<number> { const result = await this.pool.query('SELECT COALESCE(MAX(id), 0)::int AS id FROM activity_events'); return Number(result.rows[0]?.id ?? 0) }
  public async overview(): Promise<object> { const result = await this.pool.query("SELECT status,count(*)::int AS count FROM processing_jobs GROUP BY status"); const oldest = await this.pool.query("SELECT material_id,created_at FROM processing_jobs WHERE status='PROCESSING' ORDER BY created_at LIMIT 1"); return { jobs: result.rows, oldestProcessing: oldest.rows[0] ?? null } }
}

export class ProcessingWorker {
  public constructor(private readonly pool: Pool, private readonly study: MasterMeService, private readonly ingestion: IngestionService) {}
  public async processOnce(): Promise<boolean> {
    const client = await this.pool.connect(); let job: { id: string; material_id: string } | undefined
    try { await client.query('BEGIN'); await client.query("UPDATE processing_jobs SET status='PENDING',stage='RETRYING',locked_at=NULL WHERE status='PROCESSING' AND locked_at < now() - interval '5 minutes'"); const result = await client.query("SELECT id,material_id FROM processing_jobs WHERE status='PENDING' AND run_after<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"); job = result.rows[0] as typeof job; if (job) await client.query("UPDATE processing_jobs SET status='PROCESSING',stage='PREPARING',attempts=attempts+1,locked_at=now(),started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1", [job.id]); await client.query('COMMIT') } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    if (!job) return false
    // Renove o lease durante chamadas longas para impedir que o mesmo job seja
    // retomado em paralelo como se este worker tivesse morrido.
    const heartbeat = setInterval(() => {
      void this.pool.query("UPDATE processing_jobs SET locked_at=now(),updated_at=now() WHERE id=$1 AND status='PROCESSING'", [job!.id]).catch((error) => console.warn(JSON.stringify({ level: 'warn', operation: 'processing-heartbeat', jobId: job!.id, error: String(error) })))
    }, 60_000)
    await this.pool.query("UPDATE study_materials SET processing_status='PROCESSING' WHERE id=$1", [job.material_id]); await this.ingestion.event('material.progress', { materialId: job.material_id, stage: 'PREPARING', progressPercent: 1 })
    try {
      await this.study.extractConcepts(job.material_id, async (progress) => {
        const percent = progress.stage === 'REDUCING' ? 90 : Math.max(1, Math.round((progress.completedChunks / Math.max(progress.totalChunks, 1)) * 85))
        const updated = await this.pool.query("UPDATE processing_jobs SET stage=$2,total_chunks=$3,completed_chunks=$4,progress_percent=$5,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING id", [job!.id, progress.stage, progress.totalChunks, progress.completedChunks, percent])
        if (updated.rows[0]) await this.ingestion.event('material.progress', { materialId: job!.material_id, stage: progress.stage, totalChunks: progress.totalChunks, completedChunks: progress.completedChunks, progressPercent: percent })
      }, async () => this.isActive(job!.id))
      const completed = await this.pool.query("UPDATE processing_jobs SET status='DONE',stage='READY',progress_percent=100,finished_at=now(),updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING id", [job.id])
      if (!completed.rows[0]) return true
      await this.pool.query("UPDATE study_materials SET processing_status='READY',processed_at=now(),processing_error=NULL WHERE id=$1", [job.material_id])
      await this.ingestion.event('material.ready', { materialId: job.material_id, stage: 'READY', progressPercent: 100 })
    } catch (error) {
      if (!(await this.isActive(job.id))) return true
      const failure = classifyProcessingFailure(error)
      const retried = await this.pool.query("UPDATE processing_jobs SET status=CASE WHEN $3::boolean OR attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,run_after=now()+interval '30 seconds',last_error=$2,updated_at=now() WHERE id=$1 AND status='PROCESSING' RETURNING status", [job.id, String(error), !failure.retryable])
      const status = retried.rows[0]?.status === 'FAILED' ? 'FAILED' : 'PENDING'
      await this.pool.query('UPDATE study_materials SET processing_status=$2,processing_error=$3 WHERE id=$1', [job.material_id, status, failure.message])
      console.error(JSON.stringify({ level: 'error', operation: 'extract-material', materialId: job.material_id, jobId: job.id, code: failure.code, error: String(error) }))
      await this.ingestion.event(status === 'FAILED' ? 'material.failed' : 'material.queued', { materialId: job.material_id, message: failure.message, code: failure.code })
    } finally { clearInterval(heartbeat) }
    return true
  }
  private async isActive(jobId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM processing_jobs WHERE id=$1 AND status='PROCESSING'", [jobId])
    return Boolean(result.rows[0])
  }
}
