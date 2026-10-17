import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    initShadowDb: 'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY);',
  },
  datasource: { url: env('DATABASE_URL') },
  experimental: { externalTables: true },
  tables: { external: ['auth.users'] },
});
