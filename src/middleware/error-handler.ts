import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../application/errors';
import { MulterError } from 'multer';
import { normalizedRoute } from './observability';

const errorStatuses: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  INSUFFICIENT_DATA: 422,
  INVALID_STATE: 409,
  SESSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  UPLOAD_CONCURRENCY_LIMIT: 429,
  UNKNOWN_PLAN: 400,
  BILLING_NOT_CONFIGURED: 503,
  IDEMPOTENCY_KEY_REUSED: 409,
  CHECKOUT_IN_PROGRESS: 409,
  PAYMENT_ORDER_NOT_FOUND: 400,
  PAYMENT_AMOUNT_MISMATCH: 409,
  PAYMENT_REFERENCE_REQUIRED: 400,
  PAYMENT_NOT_CONFIRMED: 409,
  PAYMENT_PROVIDER_RESPONSE_TOO_LARGE: 502,
  INVALID_PAYMENT_PROVIDER_RESPONSE: 502,
  PAYMENT_PROVIDER_UNAVAILABLE: 502,
  PAYMENT_PROVIDER_REJECTED: 502,
  INVALID_UPLOAD: 400,
  INVALID_FILE: 400,
  PDF_PARSE_TIMEOUT: 408,
  MATERIAL_TOO_LARGE: 413,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_COMMIT_UNKNOWN: 503,
  EXTRACTION_NOT_ACTIVE: 409,
  ORDER_STATE_UNAVAILABLE: 503,
  ORDER_STATE_CHANGED: 409,
  PAYMENT_WEBHOOK_BACKLOG: 429,
  PAYMENT_ALREADY_USED: 409,
  AI_DISABLED: 503,
  AI_GLOBAL_LIMIT_REACHED: 503,
  AI_DAILY_CREDIT_LIMIT_REACHED: 429,
  AI_PERIOD_CREDIT_LIMIT_REACHED: 429,
  AI_CREDIT_LIMIT_REACHED: 429,
  PDF_TOO_MANY_PAGES: 413,
  AI_CREDIT_STATE_UNAVAILABLE: 503,
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next,
) => {
  const requestId = res.locals.requestId ?? 'unknown';
  if (error instanceof AppError) {
    res
      .status(error.category === 'INVALID_INPUT' ? 400 : errorStatuses[error.code] ?? 500)
      .json({ code: error.code, message: error.message, requestId });
    return;
  }
  if (error instanceof MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      code: tooLarge ? 'UPLOAD_TOO_LARGE' : 'INVALID_UPLOAD',
      message: tooLarge
        ? 'Envie um arquivo de até 16 MiB.'
        : 'Envie somente um arquivo válido.',
      requestId,
    });
    return;
  }
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    res
      .status(413)
      .json({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'O corpo da requisição excede o limite permitido.',
        requestId,
      });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(500).json({
      code: 'INVALID_EXTERNAL_RESPONSE',
      message: 'O serviço externo retornou uma resposta inválida.',
      requestId,
    });
    return;
  }
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      method: req.method,
      route: res.locals.routeTemplate ?? normalizedRoute(req),
      code: 'INTERNAL_ERROR',
    }),
  );
  res
    .status(500)
    .json({
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      requestId,
    });
};
