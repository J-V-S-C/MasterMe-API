import { fromSupabaseUrl } from '@supabase/server'
import { verifyAuth } from '@supabase/server/core'
import type { RequestHandler } from 'express'
import { AppError } from '../services/errors'

export const authenticate: RequestHandler = async (req, res, next) => {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return next(new Error('SUPABASE_URL não configurada.'))

  const headers = new Headers()
  const authorization = req.header('authorization')
  if (authorization) headers.set('authorization', authorization)
  const { data, error } = await verifyAuth(new Request(`http://localhost${req.originalUrl}`, { headers }), {
    auth: 'user',
    issuer: fromSupabaseUrl(supabaseUrl),
  })
  if (error || !data?.userClaims?.id) return next(new AppError(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.'))
  res.locals.userId = data.userClaims.id
  next()
}
