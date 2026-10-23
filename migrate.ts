import { Pool } from 'pg';
import dotenv from 'dotenv';
import { getEnvironment } from './src/config/environment';
import { runMigrations } from './src/infra/database/migration-runner';
import { projectMigrations } from './src/infra/database/migration-catalog';

// Variáveis fornecidas pelo Compose têm precedência sobre arquivos locais.
dotenv.config();
const environment = getEnvironment();
const databaseHost = new URL(environment.DATABASE_URL).hostname;
const productionPooler = databaseHost.endsWith('.pooler.supabase.com');
const localDevelopmentDatabase = environment.NODE_ENV === 'development' &&
  Boolean(process.env.DEV_DATABASE_URL) &&
  environment.DATABASE_URL === process.env.DEV_DATABASE_URL;
if (!productionPooler && !localDevelopmentDatabase) {
  throw new Error(
    'Migração bloqueada: use DEV_DATABASE_URL em desenvolvimento ou o Session pooler do Supabase.',
  );
}
const pool = new Pool({ connectionString: environment.DATABASE_URL });
try {
  console.info('Conexão com o banco de migrações confirmada.');
  const migrations = await projectMigrations();
  const client = await pool.connect();
  try {
    const result = await runMigrations(client, migrations);
    console.info(
      JSON.stringify({ level: 'info', operation: 'migrate', ...result }),
    );
  } finally {
    client.release();
  }
  console.info('Migrações concluídas sem reaplicação.');
} finally {
  await pool.end();
}
