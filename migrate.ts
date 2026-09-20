import { readFile, readdir } from 'node:fs/promises'
import { Pool } from 'pg'
import dotenv from 'dotenv'
import { getEnvironment } from './src/config/environment'

dotenv.config()
const environment = getEnvironment()
const pool = new Pool({ connectionString: environment.DATABASE_URL })
try {
  const directory = new URL('./migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await pool.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
  console.info('Migrações concluídas.')
} finally { await pool.end() }
