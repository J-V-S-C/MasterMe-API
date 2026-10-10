import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import type { AiOperation, AiUsageEvent } from '../config/llm'

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const HTTP_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const AI_OPERATIONS = new Set<AiOperation>(['EXTRACTION', 'INITIAL_EVALUATION', 'EDGE_CASE_GENERATION', 'EDGE_CASE_EVALUATION', 'PRACTICE_PROJECT', 'LOCALIZATION', 'STRESS_EVALUATION', 'ISOMORPHIC_PROBLEM'])
type Labels = Readonly<Record<string, string>>
type Histogram = { count: number; sum: number; buckets: number[] }
type QueueSnapshot = { jobs: Record<'PENDING' | 'PROCESSING' | 'FAILED', number>; oldestPendingSeconds: number; billingPending: number; billingLeased: number; aiCalls24h?: Array<{ operation: string; result: string; value: number }>; credits24h?: Array<{ operation: string; value: number }> }
const escapeLabel = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
const labelText = (labels: Labels): string => { const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)); return entries.length ? `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}` : '' }
const keyFor = (labels: Labels): string => JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
const statusClass = (status: number): string => status >= 100 && status <= 599 ? `${Math.floor(status / 100)}xx` : 'unknown'

export const normalizedRoute = (req: Pick<Request, 'baseUrl' | 'route'>): string => {
  const routePath = req.route && typeof req.route === 'object' && 'path' in req.route ? req.route.path : undefined
  if (typeof routePath !== 'string') return 'unmatched'
  return `${req.baseUrl || ''}${routePath}`.replace(/\/$/, '') || '/'
}
export class MetricsRegistry {
  private readonly requests = new Map<string, { labels: Labels; value: number }>()
  private readonly durations = new Map<string, { labels: Labels; value: Histogram }>()
  private readonly aiCalls = new Map<string, { labels: Labels; value: number }>()
  private readonly aiTokens = new Map<string, { labels: Labels; value: number }>()
  private readonly creditReservations = new Map<string, { labels: Labels; value: number }>()
  private readonly billingReconciliations = new Map<string, { labels: Labels; value: number }>()
  private queueSnapshot: QueueSnapshot = { jobs: { PENDING: 0, PROCESSING: 0, FAILED: 0 }, oldestPendingSeconds: 0, billingPending: 0, billingLeased: 0 }

  public observeHttp(methodInput: string, route: string, statusCode: number, seconds: number): void {
    const labels = { method: METHODS.has(methodInput) ? methodInput : 'OTHER', route, status_class: statusClass(statusCode) }
    this.increment(this.requests, labels, 1)
    const key = keyFor(labels)
    const current = this.durations.get(key) ?? { labels, value: { count: 0, sum: 0, buckets: HTTP_BUCKETS.map(() => 0) } }
    current.value.count += 1; current.value.sum += Math.max(0, seconds)
    HTTP_BUCKETS.forEach((bucket, index) => { if (seconds <= bucket) current.value.buckets[index]! += 1 })
    this.durations.set(key, current)
  }
  public recordAi(event: AiUsageEvent): void {
    const operation = AI_OPERATIONS.has(event.operation) ? event.operation : 'UNKNOWN'
    this.increment(this.aiCalls, { operation, result: event.success ? 'success' : 'failure' }, 1)
    if (event.inputTokens !== null) this.increment(this.aiTokens, { direction: 'input', operation }, Math.max(0, event.inputTokens))
    if (event.outputTokens !== null) this.increment(this.aiTokens, { direction: 'output', operation }, Math.max(0, event.outputTokens))
  }
  public recordCredit(operationInput: AiOperation, outcome: 'reserved' | 'blocked'): void { this.increment(this.creditReservations, { operation: AI_OPERATIONS.has(operationInput) ? operationInput : 'UNKNOWN', outcome }, 1) }
  public recordBilling(outcomeInput: string): void { const allowed = new Set(['confirmed', 'pending', 'rejected', 'retry', 'failed']); this.increment(this.billingReconciliations, { outcome: allowed.has(outcomeInput) ? outcomeInput : 'failed' }, 1) }
  public setQueueSnapshot(snapshot: QueueSnapshot): void { this.queueSnapshot = snapshot }
  public render(): string {
    const lines: string[] = []
    this.counter(lines, 'masterme_http_requests_total', 'HTTP requests by bounded route template and status class.', this.requests)
    lines.push('# HELP masterme_http_request_duration_seconds HTTP request duration.', '# TYPE masterme_http_request_duration_seconds histogram')
    for (const { labels, value } of this.durations.values()) {
      HTTP_BUCKETS.forEach((bucket, index) => lines.push(`masterme_http_request_duration_seconds_bucket${labelText({ ...labels, le: String(bucket) })} ${value.buckets[index]}`))
      lines.push(`masterme_http_request_duration_seconds_bucket${labelText({ ...labels, le: '+Inf' })} ${value.count}`, `masterme_http_request_duration_seconds_sum${labelText(labels)} ${value.sum}`, `masterme_http_request_duration_seconds_count${labelText(labels)} ${value.count}`)
    }
    this.counter(lines, 'masterme_ai_provider_calls_total', 'AI provider calls by operation and result.', this.aiCalls)
    this.counter(lines, 'masterme_ai_tokens_total', 'AI tokens reported by the provider.', this.aiTokens)
    this.counter(lines, 'masterme_ai_credit_reservations_total', 'AI credit reservations by operation and outcome.', this.creditReservations)
    this.counter(lines, 'masterme_billing_reconciliations_total', 'Billing reconciliation outcomes.', this.billingReconciliations)
    lines.push('# HELP masterme_extraction_jobs Current extraction jobs by bounded status.', '# TYPE masterme_extraction_jobs gauge')
    for (const status of ['PENDING', 'PROCESSING', 'FAILED'] as const) lines.push(`masterme_extraction_jobs${labelText({ status })} ${this.queueSnapshot.jobs[status]}`)
    lines.push('# HELP masterme_extraction_oldest_pending_seconds Age of the oldest pending extraction.', '# TYPE masterme_extraction_oldest_pending_seconds gauge', `masterme_extraction_oldest_pending_seconds ${this.queueSnapshot.oldestPendingSeconds}`, '# HELP masterme_billing_webhooks_pending Current pending billing webhook events.', '# TYPE masterme_billing_webhooks_pending gauge', `masterme_billing_webhooks_pending ${this.queueSnapshot.billingPending}`, '# HELP masterme_billing_webhooks_leased Current actively leased billing webhook events.', '# TYPE masterme_billing_webhooks_leased gauge', `masterme_billing_webhooks_leased ${this.queueSnapshot.billingLeased}`)
    lines.push('# HELP masterme_ai_provider_calls_24h Provider calls persisted by API and worker in the last 24 hours.', '# TYPE masterme_ai_provider_calls_24h gauge')
    for (const item of this.queueSnapshot.aiCalls24h ?? []) if (AI_OPERATIONS.has(item.operation as AiOperation) && (item.result === 'success' || item.result === 'failure')) lines.push(`masterme_ai_provider_calls_24h${labelText({ operation: item.operation, result: item.result })} ${Math.max(0, item.value)}`)
    lines.push('# HELP masterme_ai_credits_consumed_24h Credits consumed by API and worker in the last 24 hours.', '# TYPE masterme_ai_credits_consumed_24h gauge')
    for (const item of this.queueSnapshot.credits24h ?? []) if (AI_OPERATIONS.has(item.operation as AiOperation)) lines.push(`masterme_ai_credits_consumed_24h${labelText({ operation: item.operation })} ${Math.max(0, item.value)}`)
    return `${lines.join('\n')}\n`
  }
  private increment(target: Map<string, { labels: Labels; value: number }>, labels: Labels, amount: number): void { const key = keyFor(labels); const current = target.get(key); if (current) current.value += amount; else target.set(key, { labels, value: amount }) }
  private counter(lines: string[], name: string, help: string, values: Map<string, { labels: Labels; value: number }>): void { lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`); for (const { labels, value } of values.values()) lines.push(`${name}${labelText(labels)} ${value}`) }
}

export const requestObservability = (metrics: MetricsRegistry): RequestHandler => (req, res, next) => {
  const startedAt = performance.now(); const supplied = req.header('x-request-id')
  res.locals.requestId = supplied && REQUEST_ID.test(supplied) ? supplied : randomUUID(); res.setHeader('x-request-id', res.locals.requestId)
  res.once('finish', () => {
    const route = normalizedRoute(req); res.locals.routeTemplate = route
    const durationSeconds = Math.max(0, performance.now() - startedAt) / 1_000
    metrics.observeHttp(req.method, route, res.statusCode, durationSeconds)
    console.info(JSON.stringify({ level: 'info', requestId: res.locals.requestId, method: req.method, route, statusCode: res.statusCode, durationMs: Math.round(durationSeconds * 1_000) }))
  })
  next()
}
