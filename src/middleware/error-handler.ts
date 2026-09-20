import type { ErrorRequestHandler } from 'express'
import { z } from 'zod'
import { AppError } from '../services/errors'

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = res.locals.requestId ?? 'unknown'
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ code: error.code, message: error.message, requestId })
    return
  }
  if (error instanceof z.ZodError) {
    res.status(500).json({
      code: 'INVALID_EXTERNAL_RESPONSE',
      message: 'O serviço externo retornou uma resposta inválida.',
      requestId,
    })
    return
  }
  console.error(JSON.stringify({ level: 'error', requestId, method: req.method, path: req.path, error: String(error) }))
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.', requestId })
}
