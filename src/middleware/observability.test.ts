import { afterEach, describe, expect, test } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { MetricsRegistry, requestObservability } from './observability'
import { metricsHandler, readinessHandler } from '../services/operational-observability'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))) })
const serve = async (app: express.Express): Promise<string> => {
  const server = app.listen(0); servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('porta indisponível')
  return `http://127.0.0.1:${address.port}`
}
const queueRow = { pending: 2, processing: 1, failed: 3, oldest_pending_seconds: 42, billing_pending: 4, billing_leased: 1, ai_calls_24h: [{ operation: 'EXTRACTION', result: 'success', value: 7 }, { operation: 'FORGED', result: 'success', value: 99 }], credits_24h: [{ operation: 'EXTRACTION', value: 84 }] }

describe('observabilidade operacional', () => {
  test('propaga request ID válido, substitui inválido e não usa path de alta cardinalidade', async () => {
    const metrics = new MetricsRegistry(); const logs: string[] = []; const original = console.info
    console.info = (value?: unknown) => { logs.push(String(value)) }
    try {
      const app = express(); app.use(requestObservability(metrics)); app.get('/items/:id', (_req, res) => res.json({ ok: true }))
      const base = await serve(app)
      const valid = await fetch(`${base}/items/11111111-1111-4111-8111-111111111111?secret=no`, { headers: { 'x-request-id': 'trace-safe-1234' } })
      expect(valid.headers.get('x-request-id')).toBe('trace-safe-1234')
      const invalid = await fetch(`${base}/items/22222222-2222-4222-8222-222222222222`, { headers: { 'x-request-id': 'bad id' } })
      expect(invalid.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
      await Bun.sleep(1)
      expect(metrics.render()).toContain('route="/items/:id"')
      expect(metrics.render()).not.toContain('11111111-1111')
      expect(logs.join('\n')).not.toContain('secret=no')
      expect(logs.join('\n')).not.toContain('11111111-1111')
    } finally { console.info = original }
  })

  test('mantém liveness independente e readiness falha fechada no timeout do banco', async () => {
    const app = express(); app.get('/health', (_req, res) => res.json({ status: 'ok' }))
    app.get('/ready', readinessHandler({ query: () => new Promise(() => undefined) } as never, 20))
    const base = await serve(app)
    expect((await fetch(`${base}/health`)).status).toBe(200)
    const ready = await fetch(`${base}/ready`)
    expect(ready.status).toBe(503)
    expect(await ready.json()).toEqual({ status: 'not_ready' })
  })

  test('metrics falha fechado, compara bearer e expõe somente labels allowlisted', async () => {
    const metrics = new MetricsRegistry()
    metrics.observeHttp('BREW', '/fixed/:id', 418, 0.2)
    metrics.recordAi({ operation: 'EXTRACTION', model: 'user-controlled-model', success: false, inputTokens: 2, outputTokens: null, errorCode: 'secret' })
    metrics.recordCredit('EXTRACTION', 'reserved'); metrics.recordBilling('arbitrary')
    const pool = { query: async () => ({ rows: [queueRow] }) }
    const app = express(); app.get('/disabled', metricsHandler(pool as never, metrics, undefined, 50)); app.get('/metrics', metricsHandler(pool as never, metrics, 'x'.repeat(32), 50))
    const base = await serve(app)
    expect((await fetch(`${base}/disabled`)).status).toBe(404)
    expect((await fetch(`${base}/metrics`)).status).toBe(401)
    const response = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${'x'.repeat(32)}` } })
    const body = await response.text()
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toContain('masterme_http_requests_total{method="OTHER",route="/fixed/:id",status_class="4xx"} 1')
    expect(body).toContain('masterme_ai_provider_calls_total{operation="EXTRACTION",result="failure"} 1')
    expect(body).toContain('masterme_extraction_jobs{status="PENDING"} 2')
    expect(body).toContain('masterme_ai_provider_calls_24h{operation="EXTRACTION",result="success"} 7')
    expect(body).toContain('masterme_ai_credits_consumed_24h{operation="EXTRACTION"} 84')
    expect(body).not.toContain('FORGED')
    expect(body).not.toContain('user-controlled-model'); expect(body).not.toContain('secret'); expect(body).not.toContain('arbitrary')
  })
})
