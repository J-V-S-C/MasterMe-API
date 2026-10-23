import express from 'express';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { projectMigrations } from '../src/infra/database/migration-catalog';
import { runMigrations } from '../src/infra/database/migration-runner';
import { PrismaLearningWorkspaceRepository } from '../src/infra/repositories/prisma/prisma-learning-workspace.repository';
import { LearningWorkspaceService } from '../src/application/services/learning-workspace.service';
import { LearningWorkspaceController } from '../src/infra/controllers/learning-workspace.controller';
import { createLearningWorkspaceRouter } from '../src/infra/http/routes/learning-workspace.routes';
import { errorHandler } from '../src/middleware/error-handler';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (process.env.PHASE2_BROWSER_HARNESS !== '1' || !url)
  throw new Error('Set PHASE2_BROWSER_HARNESS=1 and MIGRATION_TEST_DATABASE_URL. This script resets the local test database.');
const database = new URL(url);
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test'))
  throw new Error('The browser harness only accepts a local *_test database.');

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '77777777-7777-4777-8777-777777777777';
const materialId = '22222222-2222-4222-8222-222222222222';
const conceptId = '33333333-3333-4333-8333-333333333333';
const pool = new Pool({ connectionString: url, max: 4 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
try {
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('DROP SCHEMA IF EXISTS auth CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('CREATE SCHEMA auth');
    await client.query('CREATE TABLE auth.users (id UUID PRIMARY KEY)');
    await runMigrations(client, await projectMigrations());
    await client.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [ownerA, ownerB]);
    await client.query(
      "INSERT INTO study_materials(id,title,content,created_at,owner_id,source_type) VALUES ($1,'Indexed queries','An index narrows candidate rows before filtering.',now(),$2,'TEXT')",
      [materialId, ownerA],
    );
    await client.query(
      "INSERT INTO concepts(id,material_id,name,description,kind,source_excerpt,fundamental_premises,edge_cases,prerequisite_ids,next_ids) VALUES ($1,$2,'Index','Narrows candidate rows','NODE','An index narrows candidate rows before filtering.','[\"The index narrows candidates.\"]','[\"A small table may use a scan.\"]','[]','[]')",
      [conceptId, materialId],
    );
  } finally { client.release(); }

  const service = new LearningWorkspaceService(new PrismaLearningWorkspaceRepository(prisma), {
    evaluateActivity: async () => ({ status: 'INCOMPLETE', missingPremises: ['Cause'], logicalBreak: null, feedback: 'Explain why the index narrows candidates.' }),
  });
  await service.createGoal(ownerA, { title: 'Understand indexes', description: 'Study the source' });
  await service.evaluateActivity(ownerA, {
    requestId: '44444444-4444-4444-8444-444444444444',
    conceptId, activityType: 'APPLICATION',
    answer: 'I would use the index to narrow candidate rows before filtering.', assisted: false,
  });

  const app = express();
  app.use(express.json());
  app.get('/api/materials', (req, res) => {
    res.json({ data: req.header('x-test-user') === ownerB ? [] : [{ id: materialId, title: 'Indexed queries', locale: 'en-US', createdAt: new Date().toISOString() }] });
  });
  app.get('/api/materials/:id/knowledge-map', (req, res) => {
    if (req.header('x-test-user') === ownerB || req.params.id !== materialId) { res.status(404).json({ code: 'NOT_FOUND' }); return; }
    res.json({ data: [] });
  });
  app.get('/api/materials/:id', (req, res) => {
    if (req.header('x-test-user') === ownerB || req.params.id !== materialId) { res.status(404).json({ code: 'NOT_FOUND' }); return; }
    res.json({ data: { id: materialId, title: 'Indexed queries', content: 'An index narrows candidate rows before filtering.', sourceType: 'TEXT', locale: 'en-US' } });
  });
  app.use('/api/learning', createLearningWorkspaceRouter(new LearningWorkspaceController(service), (req, res, next) => {
    const id = req.header('x-test-user');
    if (id !== ownerA && id !== ownerB) { res.status(401).end(); return; }
    res.locals.userId = id;
    next();
  }));
  app.use(errorHandler);
  const server = app.listen(3334, '127.0.0.1', () => console.info('phase2-browser-harness-ready:3334'));
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await pool.end();
  };
  process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
} catch (error: unknown) {
  await prisma.$disconnect();
  await pool.end();
  throw error;
}
