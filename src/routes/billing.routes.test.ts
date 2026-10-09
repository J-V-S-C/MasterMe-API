import { describe, expect, test } from 'bun:test'
import express, { type RequestHandler } from 'express'
import type { Server } from 'node:http'
import { createBillingRouter } from './billing.routes'
import type { BillingService } from '../services/billing.service'

const withServer = async (service: BillingService, run: (baseUrl: string) => Promise<void>, authenticate?: RequestHandler): Promise<void> => {
  const app = express()
  app.use(express.json({ limit: '16kb' }))
  app.use('/api/billing', createBillingRouter(service, authenticate))
  const server: Server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível.')
  try { await run(`http://127.0.0.1:${address.port}`) }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}

describe('rotas de billing', () => {
  test('catálogo é público e não atravessa autenticação', async () => {
    let authentications = 0
    const service = { catalog: () => ({ currency: 'BRL', plans: [] }) } as unknown as BillingService
    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/catalog`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toContain('public')
      expect(await response.json()).toEqual({ data: { currency: 'BRL', plans: [] } })
    }, ((_req, _res, next) => { authentications += 1; next() }))
    expect(authentications).toBe(0)
  })

  test('checkout exige autenticação, idempotência e body estrito', async () => {
    const calls: unknown[] = []
    const service = { createCheckout: async (...args: unknown[]) => {
      calls.push(args)
      return { created: true, order: { id: '22222222-2222-4222-8222-222222222222', planId: 'ESSENTIAL', amountInCents: 2_990, status: 'CHECKOUT_READY', checkoutUrl: 'https://checkout.infinitepay.com.br/x', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' } }
    } } as unknown as BillingService
    const authenticate: RequestHandler = (_req, res, next) => { res.locals.userId = '11111111-1111-4111-8111-111111111111'; next() }
    await withServer(service, async (baseUrl) => {
      const missingKey = await fetch(`${baseUrl}/api/billing/checkouts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'ESSENTIAL' }) })
      expect(missingKey.status).toBe(400)

      const extraField = await fetch(`${baseUrl}/api/billing/checkouts`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-123' }, body: JSON.stringify({ planId: 'ESSENTIAL', price: 1 }) })
      expect(extraField.status).toBe(400)

      const accepted = await fetch(`${baseUrl}/api/billing/checkouts`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-123' }, body: JSON.stringify({ planId: 'ESSENTIAL' }) })
      expect(accepted.status).toBe(201)
      expect(calls).toEqual([['11111111-1111-4111-8111-111111111111', 'ESSENTIAL', 'request-123']])
    }, authenticate)
  })

  test('webhook rejeita campos essenciais inválidos antes do serviço', async () => {
    let calls = 0
    const service = { acceptWebhook: async () => { calls += 1; return { orderId: 'unused' } } } as unknown as BillingService
    await withServer(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/webhooks/infinitepay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_nsu: 'not-a-uuid', amount: -1 }),
      })
      expect(response.status).toBe(400)
      expect(calls).toBe(0)
    })
  })

  test('webhook válido apenas persiste e sinaliza o reconciliador compartilhado', async () => {
    let accepted = 0
    let triggers = 0
    const service = { acceptWebhook: async () => { accepted += 1; return { orderId: '22222222-2222-4222-8222-222222222222' } } } as unknown as BillingService
    const app = express()
    app.use(express.json())
    app.use('/api/billing', createBillingRouter(service, undefined, () => { triggers += 1 }))
    const server: Server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Porta indisponível.')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/billing/webhooks/infinitepay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoice_slug: 'invoice-1', amount: 2_990, transaction_nsu: 'transaction-1', order_nsu: '22222222-2222-4222-8222-222222222222' }),
      })
      expect(response.status).toBe(200)
      expect(accepted).toBe(1)
      expect(triggers).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
