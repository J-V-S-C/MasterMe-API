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
