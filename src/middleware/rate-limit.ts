import type { RequestHandler } from 'express'
import { AppError } from '../services/errors'

type Entry = { count: number; resetAt: number }

const MAX_TRACKED_KEYS = 10_000

export const createRateLimit = (options: {
  windowMs: number
  max: number
  key: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => string
}): RequestHandler => {
  const entries = new Map<string, Entry>()

  return (req, res, next) => {
    const now = Date.now()
    const key = options.key(req, res)
    const current = entries.get(key)
    const entry = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + options.windowMs }
      : { ...current, count: current.count + 1 }

    entries.set(key, entry)
    if (entries.size > MAX_TRACKED_KEYS) {
      for (const [storedKey, stored] of entries) {
        if (stored.resetAt <= now || entries.size > MAX_TRACKED_KEYS) entries.delete(storedKey)
        if (entries.size <= MAX_TRACKED_KEYS) break
      }
    }

    res.setHeader('ratelimit-limit', String(options.max))
    res.setHeader('ratelimit-remaining', String(Math.max(0, options.max - entry.count)))
    res.setHeader('ratelimit-reset', String(Math.ceil(entry.resetAt / 1_000)))
    if (entry.count <= options.max) return next()

    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))
    res.setHeader('retry-after', String(retryAfter))
    next(new AppError(429, 'RATE_LIMITED', 'Muitas solicitações. Aguarde um pouco e tente novamente.'))
  }
}

export const globalRateLimit = createRateLimit({
  windowMs: 15 * 60_000,
  max: 600,
  key: (req) => `ip:${req.ip}`,
})

export const aiBurstRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req, res) => `user:${res.locals.userId ?? req.ip}`,
})

export const uploadRateLimit = createRateLimit({
  windowMs: 15 * 60_000,
  max: 8,
  key: (req, res) => `upload:${res.locals.userId ?? req.ip}`,
})

export const uploadDailyRateLimit = createRateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 24,
  key: (req, res) => `upload-day:${res.locals.userId ?? req.ip}`,
})

export const billingCheckoutRateLimit = createRateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req, res) => `billing-checkout:${res.locals.userId ?? req.ip}`,
})

export const billingWebhookRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 120,
  key: (req) => `billing-webhook:${req.ip}`,
})

export const uploadConcurrencyLimit = ((): RequestHandler => {
  const active = new Map<string, number>()
  return (req, res, next) => {
    const keys = ['upload:global', `upload:ip:${req.ip}`, `upload:user:${res.locals.userId ?? 'anonymous'}`]
    const limits = [2, 1, 1]
    if (keys.some((key, index) => (active.get(key) ?? 0) >= limits[index]!)) {
      return next(new AppError(429, 'UPLOAD_CONCURRENCY_LIMIT', 'Já existe um upload em processamento. Aguarde a conclusão antes de enviar outro arquivo.'))
    }
    for (const key of keys) active.set(key, (active.get(key) ?? 0) + 1)
    let released = false
    const release = () => {
      if (released) return
      released = true
      for (const key of keys) {
        const remaining = (active.get(key) ?? 1) - 1
        if (remaining > 0) active.set(key, remaining)
        else active.delete(key)
      }
    }
    res.once('finish', release)
    res.once('close', release)
    next()
  }
})()
