import { z } from 'zod'
import { AppError } from './errors'

const CREATE_CHECKOUT_URL = 'https://api.checkout.infinitepay.io/links'
const PAYMENT_CHECK_URL = 'https://api.checkout.infinitepay.io/payment_check'
const MAX_RESPONSE_BYTES = 32 * 1024

const CheckoutResponseSchema = z.object({ url: z.string().url() }).strict()
const PaymentCheckResponseSchema = z.object({
  success: z.boolean(),
  paid: z.boolean(),
  amount: z.number().int().nonnegative(),
  paid_amount: z.number().int().nonnegative().optional(),
  installments: z.number().int().positive().optional(),
  capture_method: z.string().min(1).max(40).optional(),
}).passthrough()

export type CreateInfinitePayCheckout = {
  handle: string
  orderNsu: string
  redirectUrl: string
  webhookUrl: string
  priceInCents: number
  description: string
}

export type InfinitePayPayment = {
  success: boolean
  paid: boolean
  amount: number
  paidAmount: number | null
  installments: number | null
  captureMethod: string | null
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppError(502, 'PAYMENT_PROVIDER_RESPONSE_TOO_LARGE', 'O provedor de pagamento retornou uma resposta acima do limite seguro.')
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new AppError(502, 'PAYMENT_PROVIDER_RESPONSE_TOO_LARGE', 'O provedor de pagamento retornou uma resposta acima do limite seguro.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(body)
  } catch {
    throw new AppError(502, 'INVALID_PAYMENT_PROVIDER_RESPONSE', 'O provedor de pagamento retornou uma resposta inválida.')
  }
}

export class InfinitePayClient {
  public constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  public async createCheckout(input: CreateInfinitePayCheckout): Promise<{ url: string }> {
    const payload = await this.post(CREATE_CHECKOUT_URL, {
      handle: input.handle,
      redirect_url: input.redirectUrl,
      webhook_url: input.webhookUrl,
      order_nsu: input.orderNsu,
      items: [{ quantity: 1, price: input.priceInCents, description: input.description }],
    })
    const parsed = CheckoutResponseSchema.safeParse(payload)
    if (!parsed.success) throw new AppError(502, 'INVALID_PAYMENT_PROVIDER_RESPONSE', 'O provedor de pagamento retornou uma resposta inválida.')
    const checkoutUrl = new URL(parsed.data.url)
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.infinitepay.com.br') {
      throw new AppError(502, 'INVALID_PAYMENT_PROVIDER_RESPONSE', 'O provedor de pagamento retornou uma URL inválida.')
    }
    return { url: checkoutUrl.toString() }
  }

  public async checkPayment(input: { handle: string; orderNsu: string; transactionNsu: string; slug: string }): Promise<InfinitePayPayment> {
    const payload = await this.post(PAYMENT_CHECK_URL, {
      handle: input.handle,
      order_nsu: input.orderNsu,
      transaction_nsu: input.transactionNsu,
      slug: input.slug,
    })
    const parsed = PaymentCheckResponseSchema.safeParse(payload)
    if (!parsed.success) throw new AppError(502, 'INVALID_PAYMENT_PROVIDER_RESPONSE', 'O provedor de pagamento retornou uma resposta inválida.')
    return {
      success: parsed.data.success,
      paid: parsed.data.paid,
      amount: parsed.data.amount,
      paidAmount: parsed.data.paid_amount ?? null,
      installments: parsed.data.installments ?? null,
      captureMethod: parsed.data.capture_method ?? null,
    }
  }

  private async post(url: typeof CREATE_CHECKOUT_URL | typeof PAYMENT_CHECK_URL, body: object): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'O provedor de pagamento está indisponível. Tente novamente mais tarde.')
    }
    let payload: unknown
    try {
      payload = await readBoundedJson(response)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'O provedor de pagamento interrompeu a resposta.')
    }
    if (!response.ok) throw new AppError(502, 'PAYMENT_PROVIDER_REJECTED', 'O provedor de pagamento recusou a operação.')
    return payload
  }
}
