import type { ValidatedRequestData } from '../middleware/validate-request'

declare global {
  namespace Express {
    interface Locals {
      requestId?: string
      routeTemplate?: string
      validated?: ValidatedRequestData
      userId?: string
      idempotencyKey?: string
    }
  }
}

export {}
