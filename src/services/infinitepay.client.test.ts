import { describe, expect, test } from 'bun:test'
import { InfinitePayClient } from './infinitepay.client'

describe('InfinitePayClient', () => {
  test('cria checkout somente no endpoint fixo e envia valores definidos pelo servidor', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new InfinitePayClient(async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ url: 'https://checkout.infinitepay.com.br/masterme?lenc=safe' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(client.createCheckout({
      handle: 'masterme',
      orderNsu: '11111111-1111-4111-8111-111111111111',
      redirectUrl: 'https://masterme.app/pagamento/retorno?orderId=11111111-1111-4111-8111-111111111111',
      webhookUrl: 'https://masterme.app/api/billing/webhooks/infinitepay',
      priceInCents: 2_990,
      description: 'MasterMe Essencial — 30 dias',
    })).resolves.toEqual({ url: 'https://checkout.infinitepay.com.br/masterme?lenc=safe' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.checkout.infinitepay.io/links')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      handle: 'masterme',
      redirect_url: 'https://masterme.app/pagamento/retorno?orderId=11111111-1111-4111-8111-111111111111',
      webhook_url: 'https://masterme.app/api/billing/webhooks/infinitepay',
      order_nsu: '11111111-1111-4111-8111-111111111111',
      items: [{ quantity: 1, price: 2_990, description: 'MasterMe Essencial — 30 dias' }],
    })
  })

  test('rejeita URL de checkout fora do host autorizado', async () => {
    const client = new InfinitePayClient(async () => new Response(JSON.stringify({ url: 'https://evil.example/steal' })))
    await expect(client.createCheckout({
      handle: 'masterme',
      orderNsu: '11111111-1111-4111-8111-111111111111',
      redirectUrl: 'https://masterme.app/pagamento/retorno',
      webhookUrl: 'https://masterme.app/api/billing/webhooks/infinitepay',
      priceInCents: 2_990,
      description: 'MasterMe Essencial — 30 dias',
    })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_PROVIDER_RESPONSE' })
  })

  test('interrompe resposta externa acima do teto', async () => {
    const client = new InfinitePayClient(async () => new Response(JSON.stringify({ padding: 'x'.repeat(40_000) })))
    await expect(client.checkPayment({
      handle: 'masterme',
      orderNsu: '11111111-1111-4111-8111-111111111111',
      transactionNsu: 'transaction-1',
      slug: 'invoice-1',
    })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_RESPONSE_TOO_LARGE' })
  })
})
