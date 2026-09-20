import type { RequestHandler, Response } from 'express'
import { z } from 'zod'

export type RequestLocation = 'body' | 'params' | 'query'

export interface RequestSchemas {
  body?: z.ZodType<unknown>
  params?: z.ZodType<unknown>
  query?: z.ZodType<unknown>
}

export interface ValidatedRequestData {
  body?: unknown
  params?: unknown
  query?: unknown
}

const validationError = (location: RequestLocation, error: z.ZodError): object => ({
  code: 'VALIDATION_ERROR',
  message: 'A requisição contém dados inválidos.',
  details: error.issues.map((issue) => ({
    location,
    path: issue.path.join('.'),
    message: issue.message,
  })),
})

export const validateRequest = (schemas: RequestSchemas): RequestHandler => (req, res, next) => {
  const validated: ValidatedRequestData = {}
  for (const location of ['body', 'params', 'query'] as const) {
    const schema = schemas[location]
    if (!schema) continue
    const result = schema.safeParse(req[location])
    if (!result.success) {
      res.status(400).json(validationError(location, result.error))
      return
    }
    validated[location] = result.data
  }
  res.locals.validated = validated
  next()
}

export const getValidated = <T>(
  response: Response,
  location: RequestLocation,
  schema: z.ZodType<T>,
): T => schema.parse(response.locals.validated?.[location])
