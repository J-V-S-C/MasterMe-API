import { describe, expect, test } from 'bun:test'
import {
  checksumMigration,
  CURRENT_SCHEMA_MANIFEST,
  runMigrations,
  type Migration,
  type MigrationClient,
} from './migration-runner'

class FakeMigrationClient implements MigrationClient {
  public readonly executedSql: string[] = []
  public readonly ledger = new Map<string, string>()
  public locks = 0
  public unlocks = 0
  public failOnSql: string | undefined
  public failOnLedgerName: string | undefined
  public failUnlock = false
  private transactionSnapshot: Map<string, string> | undefined

  public constructor(
    private readonly schemaState: { hasSchema: boolean; isCurrent: boolean },
  ) {}

  public async query(sql: string, values: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (sql.startsWith('SELECT pg_advisory_lock')) {
      this.locks += 1
      return { rows: [] }
    }
    if (sql.startsWith('SELECT pg_advisory_unlock')) {
      this.unlocks += 1
      if (this.failUnlock) throw new Error('unlock failed')
      return { rows: [] }
    }
    if (sql.startsWith('SELECT table_name FROM information_schema.tables')) {
      const tables = !this.schemaState.hasSchema
        ? []
        : this.schemaState.isCurrent ? CURRENT_SCHEMA_MANIFEST.tables : ['study_materials']
      return { rows: tables.map((table_name) => ({ table_name })) }
    }
    if (sql.startsWith('SELECT table_name, column_name, is_nullable')) {
      const columns = this.schemaState.isCurrent ? CURRENT_SCHEMA_MANIFEST.columns : ['study_materials.id']
      const notNull = new Set<string>(CURRENT_SCHEMA_MANIFEST.notNullColumns)
      return {
        rows: columns.map((entry) => {
          const [table_name, column_name] = entry.split('.')
          return { table_name, column_name, is_nullable: notNull.has(entry) ? 'NO' : 'YES' }
        }),
      }
    }
    if (sql.startsWith('SELECT tablename, indexname FROM pg_indexes')) {
      return { rows: (this.schemaState.isCurrent ? CURRENT_SCHEMA_MANIFEST.indexes : []).map((entry) => {
        const [tablename, indexname] = entry.split('.')
        return { tablename, indexname }
      }) }
    }
    if (sql.startsWith('SELECT table_name, constraint_name FROM information_schema.table_constraints')) {
      return { rows: (this.schemaState.isCurrent ? CURRENT_SCHEMA_MANIFEST.constraints : []).map((entry) => {
        const [table_name, constraint_name] = entry.split('.')
        return { table_name, constraint_name }
      }) }
    }
    if (sql.startsWith('SELECT relname AS table_name FROM pg_class')) {
      return { rows: (this.schemaState.isCurrent ? CURRENT_SCHEMA_MANIFEST.rlsTables : []).map((table_name) => ({ table_name })) }
    }
    if (sql.startsWith('SELECT filename, checksum FROM public.schema_migrations')) {
      return { rows: [...this.ledger].map(([filename, checksum]) => ({ filename, checksum })) }
    }
    if (sql.startsWith('INSERT INTO public.schema_migrations')) {
      if (values[0] === this.failOnLedgerName) throw new Error('ledger insert failed')
      this.ledger.set(String(values[0]), String(values[1]))
      return { rows: [] }
    }
    if (sql === 'BEGIN') {
      this.transactionSnapshot = new Map(this.ledger)
      return { rows: [] }
    }
    if (sql === 'COMMIT') {
      this.transactionSnapshot = undefined
      return { rows: [] }
    }
    if (sql === 'ROLLBACK') {
      this.ledger.clear()
      for (const [name, checksum] of this.transactionSnapshot ?? []) this.ledger.set(name, checksum)
      this.transactionSnapshot = undefined
      return { rows: [] }
    }
    if (!sql.startsWith('CREATE TABLE IF NOT EXISTS public.schema_migrations')) {
      this.executedSql.push(sql)
      if (sql === this.failOnSql) throw new Error('migration failed')
    }
    return { rows: [] }
  }
}

const migration = (name: string, sql: string): Migration => ({ name, sql, checksum: checksumMigration(sql) })

describe('migration runner', () => {
  test('cria baseline seguro em instalação atual e nunca reaplica SQL histórico', async () => {
    const client = new FakeMigrationClient({ hasSchema: true, isCurrent: true })
    const migrations = [
      migration('001_initial.sql', 'CREATE TABLE study_materials(id uuid);'),
      migration('009_user_ownership.sql', 'DO $$ BEGIN RAISE EXCEPTION; END $$;'),
      migration('012_realtime_performance.sql', 'CREATE INDEX activity_events_created_idx;'),
      migration('013_billing.sql', 'CREATE TABLE billing_orders(id uuid);'),
    ]
    const options = { baselineFilenames: migrations.slice(0, 3).map(({ name }) => name) }

    const first = await runMigrations(client, migrations, options)
    const second = await runMigrations(client, migrations, options)

    expect(first).toEqual({ baselined: 3, applied: ['013_billing.sql'] })
    expect(second).toEqual({ baselined: 0, applied: [] })
    expect(client.executedSql).toEqual(['CREATE TABLE billing_orders(id uuid);'])
    expect(client.unlocks).toBe(2)
  })

  test('aborta e informa artefatos ausentes em schema parcial', async () => {
    const client = new FakeMigrationClient({ hasSchema: true, isCurrent: false })
    const migrations = [migration('001_initial.sql', 'CREATE TABLE study_materials(id uuid);')]

    await expect(runMigrations(client, migrations, { baselineFilenames: ['001_initial.sql'] })).rejects.toThrow('table:activity_events')
    expect(client.executedSql).toEqual([])
  })

  test('detecta alteração em migração já aplicada', async () => {
    const client = new FakeMigrationClient({ hasSchema: false, isCurrent: false })
    client.ledger.set('001_initial.sql', checksumMigration('versão antiga'))

    await expect(runMigrations(client, [migration('001_initial.sql', 'versão alterada')], { baselineFilenames: [] })).rejects.toThrow('checksum divergente')
  })

  test('bloqueia ledger com lacuna antes de executar migração pendente', async () => {
    const client = new FakeMigrationClient({ hasSchema: false, isCurrent: false })
    const migrations = [
      migration('001_initial.sql', 'SELECT 1;'),
      migration('002_second.sql', 'SELECT 2;'),
      migration('003_third.sql', 'SELECT 3;'),
    ]
    client.ledger.set(migrations[0]!.name, migrations[0]!.checksum)
    client.ledger.set(migrations[2]!.name, migrations[2]!.checksum)

    await expect(runMigrations(client, migrations, { baselineFilenames: [] })).rejects.toThrow('lacunas')
    expect(client.executedSql).toEqual([])
  })

  test('falha no SQL reverte o ledger e não executa migrações seguintes', async () => {
    const client = new FakeMigrationClient({ hasSchema: false, isCurrent: false })
    client.failOnSql = 'SELECT broken;'
    const migrations = [
      migration('001_initial.sql', 'SELECT ok;'),
      migration('002_second.sql', 'SELECT broken;'),
      migration('003_third.sql', 'SELECT never;'),
    ]

    await expect(runMigrations(client, migrations, { baselineFilenames: [] })).rejects.toThrow('Falha na migração 002_second.sql')
    expect([...client.ledger.keys()]).toEqual(['001_initial.sql'])
    expect(client.executedSql).toEqual(['SELECT ok;', 'SELECT broken;'])
  })

  test('falha durante baseline reverte todos os marcadores', async () => {
    const client = new FakeMigrationClient({ hasSchema: true, isCurrent: true })
    const migrations = [migration('001_initial.sql', 'SELECT 1;'), migration('002_second.sql', 'SELECT 2;')]
    client.failOnLedgerName = '002_second.sql'

    await expect(runMigrations(client, migrations, { baselineFilenames: migrations.map(({ name }) => name) })).rejects.toThrow('ledger insert failed')
    expect(client.ledger.size).toBe(0)
  })

  test('preserva erro principal quando o unlock também falha', async () => {
    const client = new FakeMigrationClient({ hasSchema: true, isCurrent: false })
    client.failUnlock = true

    await expect(runMigrations(client, [migration('001_initial.sql', 'SELECT 1;')])).rejects.toThrow('não corresponde ao baseline seguro')
  })

  test('banco novo aplica cada migração apenas uma vez', async () => {
    const client = new FakeMigrationClient({ hasSchema: false, isCurrent: false })
    const migrations = [migration('001_initial.sql', 'CREATE TABLE study_materials(id uuid);')]

    expect(await runMigrations(client, migrations, { baselineFilenames: [] })).toEqual({ baselined: 0, applied: ['001_initial.sql'] })
    expect(await runMigrations(client, migrations, { baselineFilenames: [] })).toEqual({ baselined: 0, applied: [] })
    expect(client.executedSql).toHaveLength(1)
  })
})
