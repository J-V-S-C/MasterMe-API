import { readFile, readdir } from 'node:fs/promises'
import { Pool } from 'pg'
import dotenv from 'dotenv'
import { getEnvironment } from './src/config/environment'
import { checksumMigration, runMigrations, type Migration } from './src/services/migration-runner'

// Para migrações manuais, o arquivo local é a fonte explícita da configuração.
// Isso impede que uma DATABASE_URL antiga, exportada no terminal, direcione o
// comando silenciosamente para outro banco.
dotenv.config({ override: true })
const environment = getEnvironment()
const databaseHost = new URL(environment.DATABASE_URL).hostname
if (!databaseHost.endsWith('.pooler.supabase.com')) {
  throw new Error(
    'Migração bloqueada: DATABASE_URL não aponta para o Session pooler do Supabase. Use Connect > Session pooler, porta 5432.',
  )
}
const pool = new Pool({ connectionString: environment.DATABASE_URL })
try {
  console.info('Conexão confirmada com o Session pooler do Supabase.')
  const directory = new URL('./migrations/', import.meta.url)
  const migrations: Migration[] = []
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8')
    migrations.push({ name, sql, checksum: checksumMigration(sql) })
  }
  const client = await pool.connect()
  try {
    const result = await runMigrations(client, migrations)
    console.info(JSON.stringify({ level: 'info', operation: 'migrate', ...result }))
  } finally {
    client.release()
  }
  console.info('Migrações concluídas sem reaplicação.')
} finally { await pool.end() }
