import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import { NotFoundError } from '../services/errors'

type ResourceKind = 'material' | 'concept' | 'session' | 'project'

const resourceFromPath = (path: string): { kind: ResourceKind; id: string } | null => {
  const match = path.match(/^\/(materials|concepts|sessions|practice-projects)\/([0-9a-f-]{36})(?:\/|$)/i)
  if (!match) return null
  const kind = match[1] === 'materials' ? 'material' : match[1] === 'concepts' ? 'concept' : match[1] === 'sessions' ? 'session' : 'project'
  return { kind, id: match[2]! }
}

const ownershipQueries: Record<ResourceKind, string> = {
  material: 'SELECT 1 FROM study_materials WHERE id=$1 AND owner_id=$2',
  concept: 'SELECT 1 FROM concepts c JOIN study_materials m ON m.id=c.material_id WHERE c.id=$1 AND m.owner_id=$2',
  session: 'SELECT 1 FROM study_sessions s JOIN concepts c ON c.id=s.concept_id JOIN study_materials m ON m.id=c.material_id WHERE s.id=$1 AND m.owner_id=$2',
  project: 'SELECT 1 FROM practice_projects p JOIN study_materials m ON m.id=p.material_id WHERE p.id=$1 AND m.owner_id=$2',
}

export const authorizeResource = (pool: Pool): RequestHandler => async (req, res, next) => {
  const resource = resourceFromPath(req.path)
  if (!resource) return next()
  const result = await pool.query(ownershipQueries[resource.kind], [resource.id, res.locals.userId])
  if (!result.rows[0]) return next(new NotFoundError('Recurso'))
  next()
}
