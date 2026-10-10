import type { ErrorRequestHandler } from 'express'
import { z } from 'zod'
import { AppError } from '../services/errors'
import { MulterError } from 'multer'
import { normalizedRoute } from './observability'

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = res.locals.requestId ?? 'unknown'
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ code: error.code, message: error.message, requestId })
    return
  }
  if (error instanceof MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE'
    res.status(tooLarge ? 413 : 400).json({
      code: tooLarge ? 'UPLOAD_TOO_LARGE' : 'INVALID_UPLOAD',
      message: tooLarge ? 'Envie um arquivo de até 8 MiB.' : 'Envie somente um arquivo válido.',
      requestId,
    })
    return
  }
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição excede o limite permitido.', requestId })
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
  console.error(JSON.stringify({ level: 'error', requestId, method: req.method, route: res.locals.routeTemplate ?? normalizedRoute(req), code: 'INTERNAL_ERROR' }))
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.', requestId })
}
