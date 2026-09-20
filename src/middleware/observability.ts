import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = performance.now()
  res.locals.requestId = randomUUID()
  res.setHeader('x-request-id', res.locals.requestId)
  res.on('finish', () => {
    console.info(
      JSON.stringify({
        level: 'info',
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    )
  })
  next()
}
