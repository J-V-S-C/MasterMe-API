import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';

if (process.env.PHASE2_LIVE_BENCHMARK !== '1')
  throw new Error('Set PHASE2_LIVE_BENCHMARK=1 for a bounded live extraction.');
const connection = process.env.PHASE2_QUEUE_DATABASE_URL;
if (!connection) throw new Error('Set PHASE2_QUEUE_DATABASE_URL to the local development database.');
const database = new URL(connection);
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_dev'))
  throw new Error('This benchmark only accepts a local *_dev database.');

const pool = new Pool({ connectionString: connection, max: 1 });
const ownerId = randomUUID();
const materialId = randomUUID();
const jobId = randomUUID();
const paragraph = (await readFile(new URL('../test-fixtures/phase2/procedure.md', import.meta.url), 'utf8')).trim();
const content = Array.from({ length: 50 }, () => paragraph).join('\n\n');
const started = performance.now();
try {
  await pool.query('INSERT INTO auth.users(id) VALUES ($1)', [ownerId]);
  await pool.query("INSERT INTO study_materials(id,title,content,created_at,owner_id,source_type,processing_status) VALUES ($1,'Phase 2 queue benchmark',$2,now(),$3,'MARKDOWN','PENDING')", [materialId, content, ownerId]);
  await pool.query("INSERT INTO processing_jobs(id,material_id,type,stage) VALUES ($1,$2,'EXTRACT','QUEUED')", [jobId, materialId]);
  while (performance.now() - started < 120_000) {
    const result = await pool.query<{ status: string; stage: string; attempts: number; last_error: string | null }>(
      'SELECT status,stage,attempts,last_error FROM processing_jobs WHERE id=$1', [jobId],
    );
    const job = result.rows[0];
    if (job?.status === 'DONE' || job?.status === 'FAILED' || job?.status === 'CANCELLED') {
      console.log(JSON.stringify({ status: job.status, stage: job.stage, attempts: job.attempts, lastErrorCode: job.last_error, characters: content.length, durationMs: Math.round(performance.now() - started) }));
      process.exitCode = job.status === 'DONE' ? 0 : 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (performance.now() - started >= 120_000) {
    console.log(JSON.stringify({ status: 'TIMEOUT', characters: content.length }));
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
