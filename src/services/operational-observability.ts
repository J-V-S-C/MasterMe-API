import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import { MetricsRegistry } from '../middleware/observability'

const tokenMatches = (actual: string | undefined, expected: string): boolean => {
  if (!actual?.startsWith('Bearer ')) return false
  return timingSafeEqual(createHash('sha256').update(actual.slice(7)).digest(), createHash('sha256').update(expected).digest())
}
const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([operation, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); timer.unref() })]) }
  finally { if (timer) clearTimeout(timer) }
}
type ObservableQueryResult = { rows: Record<string, unknown>[] }
const queryWithDriverTimeout = (pool: Pick<Pool, 'query'>, text: string, timeoutMs: number): Promise<ObservableQueryResult> =>
  (pool.query as unknown as (config: { text: string; query_timeout: number }) => Promise<ObservableQueryResult>)({ text, query_timeout: timeoutMs })
export const readinessHandler = (pool: Pick<Pool, 'query'>, timeoutMs: number): RequestHandler => async (_req, res) => {
  res.set('cache-control', 'no-store')
  try { await withTimeout(queryWithDriverTimeout(pool, 'SELECT 1', timeoutMs), timeoutMs); res.status(200).json({ status: 'ready' }) }
  catch { res.status(503).json({ status: 'not_ready' }) }
}
export const collectQueueMetrics = async (pool: Pick<Pool, 'query'>, metrics: MetricsRegistry, timeoutMs: number): Promise<void> => {
  const result = await withTimeout(queryWithDriverTimeout(pool, `SELECT count(*) FILTER (WHERE status='PENDING')::int AS pending,count(*) FILTER (WHERE status='PROCESSING')::int AS processing,count(*) FILTER (WHERE status='FAILED')::int AS failed,coalesce(extract(epoch FROM now()-min(created_at) FILTER (WHERE status='PENDING')),0)::float8 AS oldest_pending_seconds,(SELECT count(*)::int FROM billing_payment_events WHERE event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL) AS billing_pending,(SELECT count(*)::int FROM billing_payment_events WHERE event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL AND lease_expires_at>now()) AS billing_leased,(SELECT coalesce(jsonb_agg(to_jsonb(grouped)),'[]'::jsonb) FROM (SELECT operation,CASE WHEN success THEN 'success' ELSE 'failure' END AS result,count(*)::int AS value FROM ai_usage_events WHERE created_at>=now()-interval '24 hours' GROUP BY operation,success) grouped) AS ai_calls_24h,(SELECT coalesce(jsonb_agg(to_jsonb(grouped)),'[]'::jsonb) FROM (SELECT operation,sum(credits)::int AS value FROM ai_credit_usage_events WHERE created_at>=now()-interval '24 hours' GROUP BY operation) grouped) AS credits_24h FROM processing_jobs`, timeoutMs), timeoutMs)
  const row = result.rows[0] ?? {}
  const aiCalls24h = Array.isArray(row.ai_calls_24h) ? row.ai_calls_24h : []
  const credits24h = Array.isArray(row.credits_24h) ? row.credits_24h : []
  metrics.setQueueSnapshot({ jobs: { PENDING: Number(row.pending ?? 0), PROCESSING: Number(row.processing ?? 0), FAILED: Number(row.failed ?? 0) }, oldestPendingSeconds: Math.max(0, Number(row.oldest_pending_seconds ?? 0)), billingPending: Number(row.billing_pending ?? 0), billingLeased: Number(row.billing_leased ?? 0), aiCalls24h: aiCalls24h.map((item) => ({ operation: String((item as Record<string, unknown>).operation), result: String((item as Record<string, unknown>).result), value: Number((item as Record<string, unknown>).value) })), credits24h: credits24h.map((item) => ({ operation: String((item as Record<string, unknown>).operation), value: Number((item as Record<string, unknown>).value) })) })
}
export const metricsHandler = (pool: Pick<Pool, 'query'>, metrics: MetricsRegistry, token: string | undefined, timeoutMs: number): RequestHandler => async (req, res) => {
  res.set('cache-control', 'no-store')
  if (!token) { res.status(404).json({ code: 'NOT_FOUND' }); return }
  if (!tokenMatches(req.header('authorization'), token)) { res.set('www-authenticate', 'Bearer'); res.status(401).json({ code: 'UNAUTHENTICATED' }); return }
  try { await collectQueueMetrics(pool, metrics, timeoutMs) } catch { /* Keep last bounded snapshot. */ }
  res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render())
}
