import { afterAll, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { Pool, type PoolClient } from 'pg'
import { checksumMigration, runMigrations, type Migration } from './migration-runner'

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL
const integrationTest = databaseUrl ? test : test.skip
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : undefined

afterAll(async () => {
  await pool?.end()
})

const resetDatabase = async (client: PoolClient): Promise<void> => {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE')
  await client.query('DROP SCHEMA IF EXISTS auth CASCADE')
  await client.query('CREATE SCHEMA public')
  await client.query('CREATE SCHEMA auth')
  await client.query('CREATE TABLE auth.users (id UUID PRIMARY KEY)')
}

const projectMigrations = async (): Promise<Migration[]> => {
  const directory = new URL('../../migrations/', import.meta.url)
  const migrations: Migration[] = []
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8')
    migrations.push({ name, sql, checksum: checksumMigration(sql) })
  }
  return migrations
}

integrationTest('PostgreSQL real preserva dados legados, rollback e serialização', async () => {
  if (!pool) throw new Error('Pool de integração ausente')
  const migrations = await projectMigrations()
  const client = await pool.connect()
  try {
    await resetDatabase(client)
    expect((await runMigrations(client, migrations)).applied).toHaveLength(migrations.length)
    await client.query("INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111')")
    await client.query(`INSERT INTO public.study_materials (id, title, content, created_at, owner_id)
      VALUES ('22222222-2222-4222-8222-222222222222', 'sentinela', 'não apagar', now(), '11111111-1111-4111-8111-111111111111')`)

    await client.query('DROP TABLE public.schema_migrations')
    expect(await runMigrations(client, migrations)).toEqual({ baselined: migrations.length, applied: [] })
    expect(await runMigrations(client, migrations)).toEqual({ baselined: 0, applied: [] })
    const sentinel = await client.query("SELECT content FROM public.study_materials WHERE title = 'sentinela'")
    expect(sentinel.rows).toEqual([{ content: 'não apagar' }])

    await resetDatabase(client)
    expect((await runMigrations(client, migrations.slice(0, 8), { baselineFilenames: [] })).applied).toHaveLength(8)
    await client.query(`INSERT INTO public.study_materials (id, title, content, created_at)
      VALUES ('33333333-3333-4333-8333-333333333333', 'sentinela 009', 'preservar também', now())`)
    await expect(runMigrations(client, migrations)).rejects.toThrow('Falha na migração 009_user_ownership.sql')
    const preOwnershipSentinel = await client.query("SELECT content FROM public.study_materials WHERE title = 'sentinela 009'")
    expect(preOwnershipSentinel.rows).toEqual([{ content: 'preservar também' }])
    const ownershipLedger = await client.query("SELECT filename FROM public.schema_migrations WHERE filename = '009_user_ownership.sql'")
    expect(ownershipLedger.rows).toEqual([])

    await resetDatabase(client)
    const broken = [
      { name: '001_initial.sql', sql: 'CREATE TABLE public.safe_table (id int);', checksum: checksumMigration('CREATE TABLE public.safe_table (id int);') },
      { name: '002_broken.sql', sql: 'CREATE TABLE public.broken_table (id int); SELECT missing_column FROM public.broken_table;', checksum: checksumMigration('CREATE TABLE public.broken_table (id int); SELECT missing_column FROM public.broken_table;') },
    ]
    await expect(runMigrations(client, broken, { baselineFilenames: [] })).rejects.toThrow('Falha na migração 002_broken.sql')
    const rollbackState = await client.query("SELECT to_regclass('public.safe_table') AS safe, to_regclass('public.broken_table') AS broken")
    expect(rollbackState.rows[0]).toMatchObject({ safe: 'safe_table', broken: null })
    const ledger = await client.query('SELECT filename FROM public.schema_migrations ORDER BY filename')
    expect(ledger.rows).toEqual([{ filename: '001_initial.sql' }])
  } finally {
    client.release()
  }

  const setup = await pool.connect()
  try {
    await resetDatabase(setup)
  } finally {
    setup.release()
  }
  const slowSql = 'SELECT pg_sleep(0.15); CREATE TABLE public.serialized_once (id int);'
  const concurrentMigration = [{ name: '001_initial.sql', sql: slowSql, checksum: checksumMigration(slowSql) }]
  const first = await pool.connect()
  const second = await pool.connect()
  try {
    const results = await Promise.all([
      runMigrations(first, concurrentMigration, { baselineFilenames: [] }),
      runMigrations(second, concurrentMigration, { baselineFilenames: [] }),
    ])
    expect(results.flatMap((result) => result.applied)).toEqual(['001_initial.sql'])
  } finally {
    first.release()
    second.release()
  }
})
