import { readFile, readdir } from 'node:fs/promises';
import { checksumMigration, type Migration } from './migration-runner';

// Keep the historical ledger names and SQL bytes while using the Prisma
// migration directory as the single source of migration files.
export const projectMigrations = async (): Promise<Migration[]> => {
  const directory = new URL('../../../prisma/migrations/', import.meta.url);
  const migrations: Migration[] = [];
  for (const name of (await readdir(directory))
    .filter((entry) => /^\d{3}_[a-z0-9_]+$/.test(entry))
    .sort()) {
    const sql = await readFile(new URL(`${name}/migration.sql`, directory), 'utf8');
    migrations.push({ name: `${name}.sql`, sql, checksum: checksumMigration(sql) });
  }
  return migrations;
};
