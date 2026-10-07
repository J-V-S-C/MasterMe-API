import type { RequestHandler } from 'express'
import { withAiUsageOwner } from '../services/ai-usage-context'

export const bindAiUsageOwner: RequestHandler = (_req, res, next) => {
  const ownerId = res.locals.userId
  if (!ownerId) return next(new Error('Usuário autenticado sem identificador.'))
  withAiUsageOwner(ownerId, next)
}
