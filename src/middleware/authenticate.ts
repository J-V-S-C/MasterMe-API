import { fromSupabaseUrl } from '@supabase/server';
import { verifyAuth } from '@supabase/server/core';
import type { RequestHandler } from 'express';
import { AppError } from '../application/errors';
import { Pool } from 'pg';

let developmentPool: Pool | undefined;

export const authenticate: RequestHandler = async (req, res, next) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return next(new Error('SUPABASE_URL não configurada.'));

  const headers = new Headers();
  const authorization = req.header('authorization');
  if (authorization) headers.set('authorization', authorization);
  const { data, error } = await verifyAuth(
    new Request(`http://localhost${req.originalUrl}`, { headers }),
    {
      auth: 'user',
      issuer: fromSupabaseUrl(supabaseUrl),
    },
  );
  if (error || !data?.userClaims?.id)
    return next(
      new AppError('UNAUTHENTICATED',
        'Entre na sua conta para continuar.',
      ),
    );
  const databaseUrl = process.env.DATABASE_URL;
  const localDevelopmentDatabase = process.env.NODE_ENV === 'development' &&
    Boolean(databaseUrl) &&
    Boolean(process.env.DEV_DATABASE_URL) &&
    databaseUrl === process.env.DEV_DATABASE_URL;
  if (localDevelopmentDatabase) {
    try {
      developmentPool ??= new Pool({ connectionString: databaseUrl, max: 2 });
      await developmentPool.query(
        'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
        [data.userClaims.id],
      );
    } catch (cause) {
      return next(cause);
    }
  }
  res.locals.userId = data.userClaims.id;
  next();
};
