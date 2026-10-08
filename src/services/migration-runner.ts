import { createHash } from 'node:crypto'

export type Migration = { name: string; sql: string; checksum: string }
export type MigrationClient = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

const MIGRATION_LOCK_ID = '7319726342084159001'
export const CURRENT_BASELINE_FILENAMES = [
  '001_initial.sql',
  '002_mvp_processing.sql',
  '003_extraction_observability.sql',
  '004_processing_error_classification.sql',
  '005_ai_efficiency.sql',
  '006_concept_study_questions.sql',
  '007_practice_projects.sql',
  '008_optional_edge_cases.sql',
  '009_user_ownership.sql',
  '010_ai_usage_quotas.sql',
  '011_pedagogy_i18n.sql',
  '012_realtime_performance.sql',
] as const

export const CURRENT_SCHEMA_MANIFEST = {
  tables: [
    'activity_events', 'ai_daily_quotas', 'ai_evaluation_cache', 'ai_usage_events',
    'concept_confidences', 'concepts', 'generated_artifacts', 'practice_projects',
    'processing_jobs', 'study_materials', 'study_sessions',
  ],
  columns: [
    'activity_events.created_at', 'activity_events.id', 'activity_events.owner_id', 'activity_events.payload', 'activity_events.type',
    'ai_daily_quotas.owner_id', 'ai_daily_quotas.requests', 'ai_daily_quotas.usage_date',
    'ai_evaluation_cache.created_at', 'ai_evaluation_cache.evaluation', 'ai_evaluation_cache.request_hash',
    'ai_usage_events.created_at', 'ai_usage_events.error_code', 'ai_usage_events.id', 'ai_usage_events.input_tokens', 'ai_usage_events.model', 'ai_usage_events.operation', 'ai_usage_events.output_tokens', 'ai_usage_events.owner_id', 'ai_usage_events.success',
    'concept_confidences.concept_id', 'concept_confidences.created_at', 'concept_confidences.updated_at', 'concept_confidences.value',
    'concepts.description', 'concepts.edge_case_question', 'concepts.edge_cases', 'concepts.fundamental_premises', 'concepts.generated_locale', 'concepts.id', 'concepts.kind', 'concepts.material_id', 'concepts.name', 'concepts.next_ids', 'concepts.prerequisite_ids', 'concepts.source_excerpt', 'concepts.study_question',
    'generated_artifacts.created_at', 'generated_artifacts.id', 'generated_artifacts.input_hash', 'generated_artifacts.kind', 'generated_artifacts.material_id', 'generated_artifacts.payload',
    'practice_projects.created_at', 'practice_projects.focus_mode', 'practice_projects.id', 'practice_projects.input_hash', 'practice_projects.material_id', 'practice_projects.payload',
    'processing_jobs.attempts', 'processing_jobs.completed_chunks', 'processing_jobs.created_at', 'processing_jobs.finished_at', 'processing_jobs.id', 'processing_jobs.last_error', 'processing_jobs.locked_at', 'processing_jobs.material_id', 'processing_jobs.phase_durations', 'processing_jobs.progress_percent', 'processing_jobs.run_after', 'processing_jobs.stage', 'processing_jobs.started_at', 'processing_jobs.status', 'processing_jobs.total_chunks', 'processing_jobs.type', 'processing_jobs.updated_at',
    'study_materials.content', 'study_materials.created_at', 'study_materials.id', 'study_materials.locale', 'study_materials.mime_type', 'study_materials.original_filename', 'study_materials.owner_id', 'study_materials.processed_at', 'study_materials.processing_error', 'study_materials.processing_status', 'study_materials.source_type', 'study_materials.storage_key', 'study_materials.title',
    'study_sessions.attempts', 'study_sessions.concept_id', 'study_sessions.created_at', 'study_sessions.edge_case_challenge', 'study_sessions.edge_case_status', 'study_sessions.id', 'study_sessions.question', 'study_sessions.state', 'study_sessions.stress_test', 'study_sessions.updated_at',
  ],
  notNullColumns: [
    'activity_events.created_at', 'activity_events.id', 'activity_events.owner_id', 'activity_events.payload', 'activity_events.type',
    'ai_daily_quotas.owner_id', 'ai_daily_quotas.requests', 'ai_daily_quotas.usage_date',
    'ai_evaluation_cache.created_at', 'ai_evaluation_cache.evaluation', 'ai_evaluation_cache.request_hash',
    'ai_usage_events.created_at', 'ai_usage_events.id', 'ai_usage_events.model', 'ai_usage_events.operation', 'ai_usage_events.success',
    'concept_confidences.concept_id', 'concept_confidences.created_at', 'concept_confidences.updated_at', 'concept_confidences.value',
    'concepts.description', 'concepts.edge_cases', 'concepts.fundamental_premises', 'concepts.generated_locale', 'concepts.id', 'concepts.kind', 'concepts.material_id', 'concepts.name', 'concepts.next_ids', 'concepts.prerequisite_ids', 'concepts.source_excerpt',
    'generated_artifacts.created_at', 'generated_artifacts.id', 'generated_artifacts.input_hash', 'generated_artifacts.kind', 'generated_artifacts.material_id', 'generated_artifacts.payload',
    'practice_projects.created_at', 'practice_projects.focus_mode', 'practice_projects.id', 'practice_projects.input_hash', 'practice_projects.material_id', 'practice_projects.payload',
    'processing_jobs.attempts', 'processing_jobs.completed_chunks', 'processing_jobs.created_at', 'processing_jobs.id', 'processing_jobs.material_id', 'processing_jobs.phase_durations', 'processing_jobs.progress_percent', 'processing_jobs.run_after', 'processing_jobs.stage', 'processing_jobs.status', 'processing_jobs.total_chunks', 'processing_jobs.type', 'processing_jobs.updated_at',
    'study_materials.content', 'study_materials.created_at', 'study_materials.id', 'study_materials.locale', 'study_materials.owner_id', 'study_materials.processing_status', 'study_materials.source_type', 'study_materials.title',
    'study_sessions.attempts', 'study_sessions.concept_id', 'study_sessions.created_at', 'study_sessions.edge_case_status', 'study_sessions.id', 'study_sessions.question', 'study_sessions.state', 'study_sessions.updated_at',
  ],
  indexes: [
    'activity_events.activity_events_created_idx', 'activity_events.activity_events_owner_id_idx',
    'ai_usage_events.ai_usage_events_created_at_idx', 'ai_usage_events.ai_usage_events_owner_created_idx',
    'concepts.concepts_material_id_idx', 'practice_projects.practice_projects_material_created_idx',
    'processing_jobs.processing_jobs_active_material_type', 'processing_jobs.processing_jobs_status_created_idx',
    'study_materials.study_materials_owner_created_idx', 'study_sessions.study_sessions_concept_id_idx',
    'study_sessions.study_sessions_concept_updated_idx',
  ],
  constraints: [
    'activity_events.activity_events_owner_id_fkey', 'activity_events.activity_events_pkey',
    'ai_daily_quotas.ai_daily_quotas_owner_id_fkey', 'ai_daily_quotas.ai_daily_quotas_pkey', 'ai_daily_quotas.ai_daily_quotas_requests_check',
    'ai_evaluation_cache.ai_evaluation_cache_pkey', 'ai_usage_events.ai_usage_events_owner_id_fkey', 'ai_usage_events.ai_usage_events_pkey',
    'concept_confidences.concept_confidences_concept_id_fkey', 'concept_confidences.concept_confidences_pkey', 'concept_confidences.concept_confidences_value_check',
    'concepts.concepts_generated_locale_check', 'concepts.concepts_material_id_fkey', 'concepts.concepts_pkey',
    'generated_artifacts.generated_artifacts_kind_input_hash_key', 'generated_artifacts.generated_artifacts_material_id_fkey', 'generated_artifacts.generated_artifacts_pkey',
    'practice_projects.practice_projects_input_hash_key', 'practice_projects.practice_projects_material_id_fkey', 'practice_projects.practice_projects_pkey',
    'processing_jobs.processing_jobs_material_id_fkey', 'processing_jobs.processing_jobs_pkey',
    'study_materials.study_materials_locale_check', 'study_materials.study_materials_owner_id_fkey', 'study_materials.study_materials_pkey',
    'study_sessions.study_sessions_concept_id_fkey', 'study_sessions.study_sessions_pkey',
  ],
  rlsTables: [
    'activity_events', 'ai_daily_quotas', 'ai_evaluation_cache', 'ai_usage_events',
    'concept_confidences', 'concepts', 'generated_artifacts', 'practice_projects',
    'processing_jobs', 'study_materials', 'study_sessions',
  ],
} as const

export const checksumMigration = (sql: string): string =>
  createHash('sha256').update(sql).digest('hex')

const appliedMigrations = async (client: MigrationClient): Promise<Map<string, string>> => {
  const result = await client.query('SELECT filename, checksum FROM public.schema_migrations ORDER BY filename')
  return new Map(result.rows.map((row) => [String(row.filename), String(row.checksum)]))
}

const validateMigrationSet = (migrations: Migration[]): void => {
  const names = new Set<string>()
  for (const item of migrations) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(item.name)) throw new Error(`Nome de migração inválido: ${item.name}`)
    if (names.has(item.name)) throw new Error(`Migração duplicada: ${item.name}`)
    names.add(item.name)
    if (item.checksum !== checksumMigration(item.sql)) throw new Error(`Checksum inválido em memória: ${item.name}`)
  }
  const ordered = [...names].sort((left, right) => left.localeCompare(right))
  if (migrations.some((item, index) => item.name !== ordered[index])) {
    throw new Error('As migrações devem estar em ordem lexical crescente.')
  }
}

const missingFrom = (expected: readonly string[], actual: Set<string>, kind: string): string[] =>
  expected.filter((item) => !actual.has(item)).map((item) => `${kind}:${item}`)

const inspectCurrentSchema = async (client: MigrationClient): Promise<{ hasSchema: boolean; missing: string[] }> => {
  const tablesResult = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
  const columnsResult = await client.query("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'")
  const indexesResult = await client.query("SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'")
  const constraintsResult = await client.query(`SELECT table_name, constraint_name FROM information_schema.table_constraints WHERE constraint_schema = 'public'`)
  const rlsResult = await client.query(`SELECT relname AS table_name FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relrowsecurity`)
  const tables = new Set(tablesResult.rows.map((row) => String(row.table_name)))
  const columns = new Set(columnsResult.rows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`))
  const notNullColumns = new Set(columnsResult.rows
    .filter((row) => String(row.is_nullable) === 'NO')
    .map((row) => `${String(row.table_name)}.${String(row.column_name)}`))
  const indexes = new Set(indexesResult.rows.map((row) => `${String(row.tablename)}.${String(row.indexname)}`))
  const constraints = new Set(constraintsResult.rows.map((row) => `${String(row.table_name)}.${String(row.constraint_name)}`))
  const rlsTables = new Set(rlsResult.rows.map((row) => String(row.table_name)))
  const hasSchema = CURRENT_SCHEMA_MANIFEST.tables.some((table) => tables.has(table))
  if (!hasSchema) return { hasSchema: false, missing: [] }
  return {
    hasSchema,
    missing: [
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.tables, tables, 'table'),
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.columns, columns, 'column'),
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.notNullColumns, notNullColumns, 'not-null'),
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.indexes, indexes, 'index'),
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.constraints, constraints, 'constraint'),
      ...missingFrom(CURRENT_SCHEMA_MANIFEST.rlsTables, rlsTables, 'rls'),
    ],
  }
}

const baselineExistingSchema = async (
  client: MigrationClient,
  migrations: Migration[],
  baselineFilenames: readonly string[],
): Promise<number> => {
  const state = await inspectCurrentSchema(client)
  if (!state.hasSchema) return 0
  if (state.missing.length > 0) {
    throw new Error(`O banco já possui schema, mas não corresponde ao baseline seguro (${state.missing.join(', ')}). Migração automática bloqueada; faça reconciliação manual.`)
  }
  if (baselineFilenames.length === 0) {
    throw new Error('Um schema existente não pode receber baseline vazio.')
  }
  const expectedPrefix = migrations.slice(0, baselineFilenames.length).map((item) => item.name)
  if (baselineFilenames.some((name, index) => name !== expectedPrefix[index])) {
    throw new Error('O baseline deve ser um prefixo contínuo das migrações locais.')
  }

  const byName = new Map(migrations.map((item) => [item.name, item]))
  const baseline = baselineFilenames.map((name) => {
    const item = byName.get(name)
    if (!item) throw new Error(`Arquivo necessário ao baseline ausente: ${name}`)
    return item
  })
  await client.query('BEGIN')
  try {
    for (const item of baseline) {
      await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING', [item.name, item.checksum])
    }
    await client.query('COMMIT')
    return baseline.length
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  }
}

export const runMigrations = async (
  client: MigrationClient,
  migrations: Migration[],
  options: { baselineFilenames?: readonly string[] } = {},
): Promise<{ baselined: number; applied: string[] }> => {
  validateMigrationSet(migrations)
  await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID])
  let primaryError: unknown
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    let applied = await appliedMigrations(client)
    const baselined = applied.size === 0
      ? await baselineExistingSchema(client, migrations, options.baselineFilenames ?? CURRENT_BASELINE_FILENAMES)
      : 0
    if (baselined) applied = await appliedMigrations(client)

    const local = new Map(migrations.map((item) => [item.name, item]))
    for (const [filename, checksum] of applied) {
      const item = local.get(filename)
      if (!item) throw new Error(`Migração aplicada não existe mais no repositório: ${filename}`)
      if (item.checksum !== checksum) throw new Error(`Migração aplicada possui checksum divergente: ${filename}`)
    }
    const expectedPrefix = migrations.slice(0, applied.size).map((item) => item.name)
    if (applied.size > migrations.length || expectedPrefix.some((name) => !applied.has(name))) {
      throw new Error('O histórico de migrações possui lacunas ou não é um prefixo contínuo. Execução automática bloqueada.')
    }

    const pending = migrations.filter((item) => !applied.has(item.name))
    const completed: string[] = []
    for (const item of pending) {
      await client.query('BEGIN')
      try {
        await client.query(item.sql)
        await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)', [item.name, item.checksum])
        await client.query('COMMIT')
        completed.push(item.name)
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw new Error(`Falha na migração ${item.name}`, { cause: error })
      }
    }
    return { baselined, applied: completed }
  } catch (error: unknown) {
    primaryError = error
    throw error
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID])
    } catch (unlockError: unknown) {
      if (primaryError === undefined) throw unlockError
    }
  }
}
