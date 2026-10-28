import { describe, expect, test } from 'bun:test'
import { MulterError } from 'multer'
import type { NextFunction, Request, Response } from 'express'
import { errorHandler } from './error-handler'
import { AppError, NotFoundError } from '../application/errors'

describe('errorHandler', () => {
  test('maps application error codes and semantic categories to HTTP status', () => {
    const cases: Array<[AppError, number]> = [
      [new NotFoundError('Material'), 404],
      [new AppError('PAYMENT_AMOUNT_MISMATCH', 'Mismatched amount'), 409],
      [new AppError('PAYMENT_AMOUNT_MISMATCH', 'Invalid amount', 'INVALID_INPUT'), 400],
      [new AppError('AI_CREDIT_LIMIT_REACHED', 'Credits exhausted'), 429],
      [new AppError('BILLING_NOT_CONFIGURED', 'Unavailable'), 503],
      [new AppError('UNRECOGNIZED_ERROR', 'Unknown'), 500],
    ]
    for (const [error, expectedStatus] of cases) {
      let actualStatus = 0
      let payload: unknown
      const response = {
        locals: { requestId: 'request-3' },
        status(code: number) { actualStatus = code; return this },
        json(value: unknown) { payload = value; return this },
      } as unknown as Response
      errorHandler(error, { method: 'POST', path: '/api/test' } as Request, response, (() => undefined) as NextFunction)
      expect(actualStatus).toBe(expectedStatus)
      expect(payload).toEqual({ code: error.code, message: error.message, requestId: 'request-3' })
    }
  })
  test('maps Multer size limit to a stable 413', () => {
    let statusCode = 0
    let payload: unknown
    const response = {
      locals: { requestId: 'request-1' },
      status(code: number) { statusCode = code; return this },
      json(value: unknown) { payload = value; return this },
    } as unknown as Response

    errorHandler(new MulterError('LIMIT_FILE_SIZE'), { method: 'POST', path: '/api/materials' } as Request, response, (() => undefined) as NextFunction)

    expect(statusCode).toBe(413)
    expect(payload).toEqual({ code: 'UPLOAD_TOO_LARGE', message: 'Envie um arquivo de até 16 MiB.', requestId: 'request-1' })
  })

  test('maps webhook JSON size limit to a stable 413', () => {
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
