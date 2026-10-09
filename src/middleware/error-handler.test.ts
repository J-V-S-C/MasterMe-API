import { describe, expect, test } from 'bun:test'
import { MulterError } from 'multer'
import type { NextFunction, Request, Response } from 'express'
import { errorHandler } from './error-handler'

describe('errorHandler', () => {
  test('converte limite de tamanho do multer em 413 estável', () => {
    let statusCode = 0
    let payload: unknown
    const response = {
      locals: { requestId: 'request-1' },
      status(code: number) { statusCode = code; return this },
      json(value: unknown) { payload = value; return this },
    } as unknown as Response

    errorHandler(new MulterError('LIMIT_FILE_SIZE'), { method: 'POST', path: '/api/materials' } as Request, response, (() => undefined) as NextFunction)

    expect(statusCode).toBe(413)
    expect(payload).toEqual({ code: 'UPLOAD_TOO_LARGE', message: 'Envie um arquivo de até 8 MiB.', requestId: 'request-1' })
  })

  test('converte limite de JSON do webhook em 413 estável', () => {
    let statusCode = 0
    let payload: unknown
    const response = {
      locals: { requestId: 'request-2' },
      status(code: number) { statusCode = code; return this },
      json(value: unknown) { payload = value; return this },
    } as unknown as Response

    errorHandler({ type: 'entity.too.large' }, { method: 'POST', path: '/api/billing/webhooks/infinitepay' } as Request, response, (() => undefined) as NextFunction)

    expect(statusCode).toBe(413)
    expect(payload).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição excede o limite permitido.', requestId: 'request-2' })
  })
})
