import type { ValidatedRequestData } from '../middleware/validate-request'

declare global {
  namespace Express {
    interface Locals {
      requestId?: string
      validated?: ValidatedRequestData
    }
  }
}

export {}
