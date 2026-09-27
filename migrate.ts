import { readFile, readdir } from 'node:fs/promises'
import { Pool } from 'pg'
import dotenv from 'dotenv'
import { getEnvironment } from './src/config/environment'

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
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await pool.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
  console.info('Migrações concluídas.')
} finally { await pool.end() }
