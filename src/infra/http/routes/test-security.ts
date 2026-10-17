import type { RequestHandler } from 'express';

const authenticate: RequestHandler = (_req, res, next) => {
  res.locals.userId = '11111111-1111-4111-8111-111111111111';
  next();
};
const passthrough: RequestHandler = (_req, _res, next) => next();

/** Tests opt into their security substitute; production never silently disables authorization. */
export const testSecurity = [authenticate, passthrough, passthrough] as const;
