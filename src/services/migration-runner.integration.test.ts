import { afterAll, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { Pool, type PoolClient } from 'pg'
import { checksumMigration, runMigrations, type Migration } from './migration-runner'
import { PostgresMasterMeRepository } from '../repositories/postgres-masterme.repository'
import { PostgresBillingRepository } from '../repositories/postgres-billing.repository'

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL
if (process.env.MIGRATION_TEST_REQUIRED === 'true' && !databaseUrl) {
  throw new Error('MIGRATION_TEST_DATABASE_URL é obrigatória no CI; a suíte PostgreSQL real não pode ser ignorada.')
}
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
    await client.query(`INSERT INTO auth.users (id) VALUES
      ('11111111-1111-4111-8111-111111111111'),
      ('77777777-7777-4777-8777-777777777777'),
      ('88888888-8888-4888-8888-888888888888')`)
    const billing = new PostgresBillingRepository(pool)
    const reservations = await Promise.allSettled(Array.from({ length: 6 }, () => billing.reserveCredits(
      '11111111-1111-4111-8111-111111111111',
      'INITIAL_EVALUATION',
      { enabled: true, globalDailyLimit: 1_000 },
    )))
    expect(reservations.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(reservations.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const creditUsage = await client.query(`SELECT
      (SELECT credits FROM ai_credit_daily_usage WHERE owner_id='11111111-1111-4111-8111-111111111111')::int AS daily,
      (SELECT credits FROM ai_credit_monthly_usage WHERE owner_id='11111111-1111-4111-8111-111111111111')::int AS monthly,
      (SELECT count(*) FROM ai_credit_usage_events WHERE owner_id='11111111-1111-4111-8111-111111111111')::int AS events`)
    expect(creditUsage.rows).toEqual([{ daily: 10, monthly: 10, events: 5 }])

    const essentialFirst = await billing.createOrGetOrder({
      id: '66666666-6666-4666-8666-666666666666',
      ownerId: '11111111-1111-4111-8111-111111111111',
      planId: 'ESSENTIAL',
      amountInCents: 2_990,
      idempotencyKeyHash: 'a'.repeat(64),
    })
    await billing.confirmPayment({ orderId: essentialFirst.order.id, transactionNsu: 'transaction-essential-first', invoiceSlug: 'invoice-essential-first', captureMethod: 'pix' })
    const essentialBeforeUpgrade = await client.query("SELECT valid_until,credit_limit::int FROM billing_entitlements WHERE owner_id='11111111-1111-4111-8111-111111111111' AND plan_id='ESSENTIAL'")
    const proSecond = await billing.createOrGetOrder({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', ownerId: '11111111-1111-4111-8111-111111111111',
      planId: 'PRO', amountInCents: 24_900, idempotencyKeyHash: 'b'.repeat(64),
    })
    await billing.confirmPayment({ orderId: proSecond.order.id, transactionNsu: 'transaction-pro-second', invoiceSlug: 'invoice-pro-second', captureMethod: 'pix' })
    const upgradeTiers = await client.query("SELECT plan_id,credit_limit::int,credits_used::int,valid_until FROM billing_entitlements WHERE owner_id='11111111-1111-4111-8111-111111111111' ORDER BY plan_id")
    expect(upgradeTiers.rows.map((row) => ({ plan_id: row.plan_id, credit_limit: row.credit_limit, credits_used: row.credits_used }))).toEqual([
      { plan_id: 'ESSENTIAL', credit_limit: 1_500, credits_used: 0 },
      { plan_id: 'PRO', credit_limit: 15_000, credits_used: 0 },
    ])
    expect(new Date(upgradeTiers.rows[0].valid_until).toISOString()).toBe(new Date(essentialBeforeUpgrade.rows[0].valid_until).toISOString())
    expect(await billing.getCreditBalance('11111111-1111-4111-8111-111111111111')).toMatchObject({ planId: 'PRO', periodLimit: 15_000, periodUsed: 0 })
    await billing.reserveCredits('11111111-1111-4111-8111-111111111111', 'INITIAL_EVALUATION', { enabled: true, globalDailyLimit: 1_000 })
    const isolatedUsage = await client.query("SELECT plan_id,credits_used::int FROM billing_entitlements WHERE owner_id='11111111-1111-4111-8111-111111111111' ORDER BY plan_id")
    expect(isolatedUsage.rows).toEqual([{ plan_id: 'ESSENTIAL', credits_used: 0 }, { plan_id: 'PRO', credits_used: 2 }])
    const essentialRepurchase = await billing.createOrGetOrder({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', ownerId: '11111111-1111-4111-8111-111111111111',
      planId: 'ESSENTIAL', amountInCents: 2_990, idempotencyKeyHash: '9'.repeat(64),
    })
    await billing.confirmPayment({ orderId: essentialRepurchase.order.id, transactionNsu: 'transaction-essential-repeat', invoiceSlug: 'invoice-essential-repeat', captureMethod: 'pix' })
    const repeatedTier = await client.query("SELECT plan_id,credit_limit::int,valid_until FROM billing_entitlements WHERE owner_id='11111111-1111-4111-8111-111111111111' ORDER BY plan_id")
    expect(repeatedTier.rows.map((row) => ({ plan_id: row.plan_id, credit_limit: row.credit_limit }))).toEqual([
      { plan_id: 'ESSENTIAL', credit_limit: 3_000 },
      { plan_id: 'PRO', credit_limit: 15_000 },
    ])
    expect(new Date(repeatedTier.rows[0].valid_until).getTime()).toBe(new Date(essentialBeforeUpgrade.rows[0].valid_until).getTime() + 30 * 24 * 60 * 60 * 1_000)
    expect(new Date(repeatedTier.rows[1].valid_until).toISOString()).toBe(new Date(upgradeTiers.rows[1].valid_until).toISOString())

    const proFirst = await billing.createOrGetOrder({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', ownerId: '77777777-7777-4777-8777-777777777777',
      planId: 'PRO', amountInCents: 24_900, idempotencyKeyHash: 'c'.repeat(64),
    })
    await billing.confirmPayment({ orderId: proFirst.order.id, transactionNsu: 'transaction-pro-first', invoiceSlug: 'invoice-pro-first', captureMethod: 'pix' })
    const proBeforeDowngrade = await client.query("SELECT valid_until,credit_limit::int FROM billing_entitlements WHERE owner_id='77777777-7777-4777-8777-777777777777' AND plan_id='PRO'")
    const essentialSecond = await billing.createOrGetOrder({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', ownerId: '77777777-7777-4777-8777-777777777777',
      planId: 'ESSENTIAL', amountInCents: 2_990, idempotencyKeyHash: 'd'.repeat(64),
    })
    await billing.confirmPayment({ orderId: essentialSecond.order.id, transactionNsu: 'transaction-essential-second', invoiceSlug: 'invoice-essential-second', captureMethod: 'pix' })
    const downgradeTiers = await client.query("SELECT plan_id,credit_limit::int,valid_until FROM billing_entitlements WHERE owner_id='77777777-7777-4777-8777-777777777777' ORDER BY plan_id")
    expect(downgradeTiers.rows.map((row) => ({ plan_id: row.plan_id, credit_limit: row.credit_limit }))).toEqual([
      { plan_id: 'ESSENTIAL', credit_limit: 1_500 },
      { plan_id: 'PRO', credit_limit: 15_000 },
    ])
    expect(new Date(downgradeTiers.rows[1].valid_until).toISOString()).toBe(new Date(proBeforeDowngrade.rows[0].valid_until).toISOString())
    expect(await billing.getCreditBalance('77777777-7777-4777-8777-777777777777')).toMatchObject({ planId: 'PRO', periodLimit: 15_000 })

    const concurrentOrder = await billing.createOrGetOrder({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', ownerId: '88888888-8888-4888-8888-888888888888',
      planId: 'ESSENTIAL', amountInCents: 2_990, idempotencyKeyHash: 'e'.repeat(64),
    })
    const confirmation = { orderId: concurrentOrder.order.id, transactionNsu: 'transaction-concurrent', invoiceSlug: 'invoice-concurrent', captureMethod: 'pix' }
    await Promise.all([
      new PostgresBillingRepository(pool).confirmPayment(confirmation),
      new PostgresBillingRepository(pool).confirmPayment(confirmation),
    ])
    const repeatedGrant = await client.query('SELECT count(*)::int AS grants FROM billing_entitlement_grants WHERE order_id=$1', [concurrentOrder.order.id])
    expect(repeatedGrant.rows).toEqual([{ grants: 1 }])
    expect(await billing.getCreditBalance('88888888-8888-4888-8888-888888888888')).toMatchObject({ planId: 'ESSENTIAL', periodLimit: 1_500 })

    const reusedTransactionOrders = await Promise.all([
      billing.createOrGetOrder({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02', ownerId: '88888888-8888-4888-8888-888888888888',
        planId: 'ESSENTIAL', amountInCents: 2_990, idempotencyKeyHash: '1'.repeat(64),
      }),
      billing.createOrGetOrder({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc03', ownerId: '88888888-8888-4888-8888-888888888888',
        planId: 'ESSENTIAL', amountInCents: 2_990, idempotencyKeyHash: '2'.repeat(64),
      }),
    ])
    const reusedTransaction = await Promise.allSettled(reusedTransactionOrders.map(({ order: pendingOrder }, index) =>
      new PostgresBillingRepository(pool).confirmPayment({
        orderId: pendingOrder.id,
        transactionNsu: 'transaction-reused-concurrently',
        invoiceSlug: `invoice-reused-${index}`,
        captureMethod: 'pix',
      })))
    expect(reusedTransaction.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const reusedFailure = reusedTransaction.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
    expect(reusedFailure?.reason).toMatchObject({ statusCode: 409, code: 'PAYMENT_ALREADY_USED' })
    const reusedState = await client.query(
      'SELECT count(*) FILTER (WHERE status=\'PAID\')::int AS paid,(SELECT count(*)::int FROM billing_entitlement_grants WHERE order_id IN ($1,$2)) AS grants FROM billing_orders WHERE id IN ($1,$2)',
      reusedTransactionOrders.map(({ order: pendingOrder }) => pendingOrder.id),
    )
    expect(reusedState.rows).toEqual([{ paid: 1, grants: 1 }])

    const webhookOrder = await billing.createOrGetOrder({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01', ownerId: '88888888-8888-4888-8888-888888888888',
      planId: 'PRO', amountInCents: 24_900, idempotencyKeyHash: 'f'.repeat(64),
    })
    const webhookAdmissions = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => billing.recordWebhook({
      orderId: webhookOrder.order.id,
      eventKey: `event-${index}`,
      transactionNsu: `webhook-transaction-${index}`,
      invoiceSlug: `webhook-invoice-${index}`,
      amountInCents: 24_900,
    })))
    expect(webhookAdmissions.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(webhookAdmissions.filter((result) => result.status === 'rejected')).toHaveLength(15)
    const admittedEvents = await client.query("SELECT id,event_key FROM billing_payment_events WHERE order_id=$1 AND event_type='WEBHOOK_RECEIVED' ORDER BY id", [webhookOrder.order.id])
    expect(admittedEvents.rows).toHaveLength(5)
    const terminal = admittedEvents.rows[0]
    await client.query("UPDATE billing_payment_events SET processed_at=now(),last_error_code='PAYMENT_NOT_CONFIRMED' WHERE id=$1", [terminal.id])
    await expect(billing.recordWebhook({
      orderId: webhookOrder.order.id,
      eventKey: 'event-new-after-terminal',
      transactionNsu: 'webhook-transaction-new',
      invoiceSlug: 'webhook-invoice-new',
      amountInCents: 24_900,
    })).resolves.toBeNumber()
    expect(await billing.recordWebhook({
      orderId: webhookOrder.order.id,
      eventKey: terminal.event_key,
      transactionNsu: 'webhook-transaction-0',
      invoiceSlug: 'webhook-invoice-0',
      amountInCents: 24_900,
    })).toBe(Number(terminal.id))
    const terminalReplay = await client.query('SELECT processed_at IS NOT NULL AS processed,attempts,last_error_code FROM billing_payment_events WHERE id=$1', [terminal.id])
    expect(terminalReplay.rows).toEqual([{ processed: true, attempts: 0, last_error_code: 'PAYMENT_NOT_CONFIRMED' }])
    const pendingBacklog = await client.query("SELECT count(*)::int AS pending FROM billing_payment_events WHERE order_id=$1 AND event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL", [webhookOrder.order.id])
    expect(pendingBacklog.rows).toEqual([{ pending: 5 }])
    await expect(billing.recordWebhook({
      orderId: webhookOrder.order.id,
      eventKey: 'event-overflow',
      transactionNsu: 'webhook-transaction-overflow',
      invoiceSlug: 'webhook-invoice-overflow',
      amountInCents: 24_900,
    })).rejects.toMatchObject({ statusCode: 429, code: 'PAYMENT_WEBHOOK_BACKLOG' })
    await client.query("UPDATE billing_payment_events SET processed_at=coalesce(processed_at,now()),lease_token=NULL,lease_expires_at=NULL WHERE order_id=$1 AND event_type='WEBHOOK_RECEIVED'", [webhookOrder.order.id])

    for (let index = 0; index < 6; index += 1) {
      const distributedOrder = await billing.createOrGetOrder({
        id: `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`,
        ownerId: '88888888-8888-4888-8888-888888888888',
        planId: 'PRO',
        amountInCents: 24_900,
        idempotencyKeyHash: String(index + 3).repeat(64),
      })
      for (let eventIndex = 0; eventIndex < 2; eventIndex += 1) {
        await billing.recordWebhook({
          orderId: distributedOrder.order.id,
          eventKey: `distributed-${index}-${eventIndex}`,
          transactionNsu: `distributed-transaction-${index}-${eventIndex}`,
          invoiceSlug: `distributed-invoice-${index}-${eventIndex}`,
          amountInCents: 24_900,
        })
      }
    }
    const firstBillingInstance = new PostgresBillingRepository(pool)
    const secondBillingInstance = new PostgresBillingRepository(pool)
    const distributedClaims = (await Promise.all([
      firstBillingInstance.claimPendingWebhooks(5),
      secondBillingInstance.claimPendingWebhooks(5),
    ])).flat()
    expect(distributedClaims).toHaveLength(5)
    expect(new Set(distributedClaims.map((event) => event.orderId)).size).toBe(5)
    expect(await secondBillingInstance.claimPendingWebhooks(5)).toEqual([])
    const activeLeases = await client.query("SELECT count(*)::int AS leases FROM billing_payment_events WHERE event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL AND lease_expires_at>now()")
    expect(activeLeases.rows).toEqual([{ leases: 5 }])
    await Promise.all(distributedClaims.map((event) => firstBillingInstance.finishWebhook(event.id, event.leaseToken, null, false)))
    const followingClaims = await secondBillingInstance.claimPendingWebhooks(5)
    expect(followingClaims).toHaveLength(5)
    expect(new Set(followingClaims.map((event) => event.orderId)).size).toBe(5)

    await client.query(`INSERT INTO public.study_materials (id, title, content, created_at, owner_id)
      VALUES ('22222222-2222-4222-8222-222222222222', 'sentinela', 'não apagar', now(), '11111111-1111-4111-8111-111111111111')`)
    await client.query(`INSERT INTO public.concepts
      (id,material_id,name,description,kind,source_excerpt,fundamental_premises,edge_cases,prerequisite_ids,next_ids)
      VALUES ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Concorrência','Teste','NODE','não apagar','["premissa"]','["limite"]','[]','[]')`)
    await client.query(`INSERT INTO public.study_sessions
      (id,concept_id,state,question,attempts,created_at,updated_at)
      VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','QUESTION_READY',
      '{"text":"Como funciona?","targetPremise":"premissa","expectedReasoningSteps":["explicar"]}','[]',now(),now())`)

    const firstRepository = new PostgresMasterMeRepository(pool)
    const secondRepository = new PostgresMasterMeRepository(pool)
    const tokenA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const tokenB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const claims = await Promise.all([
      firstRepository.claimSessionOperation('55555555-5555-4555-8555-555555555555', 1, 'same-operation', tokenA),
      secondRepository.claimSessionOperation('55555555-5555-4555-8555-555555555555', 1, 'same-operation', tokenB),
    ])
    expect(claims.filter((version) => version !== undefined)).toEqual([1])
    const winningIndex = claims.findIndex((version) => version === 1)
    await (winningIndex === 0 ? firstRepository : secondRepository).releaseSessionOperation(
      '55555555-5555-4555-8555-555555555555', 1, winningIndex === 0 ? tokenA : tokenB,
    )

    expect(await firstRepository.claimSessionOperation('55555555-5555-4555-8555-555555555555', 1, 'same-operation', tokenA)).toBe(1)
    await client.query("UPDATE study_sessions SET pending_operation_started_at=now()-interval '11 minutes' WHERE id='55555555-5555-4555-8555-555555555555'")
    expect(await firstRepository.renewSessionOperation('55555555-5555-4555-8555-555555555555', 1, tokenA)).toBe(true)
    expect(await secondRepository.claimSessionOperation('55555555-5555-4555-8555-555555555555', 1, 'same-operation', tokenB)).toBeUndefined()
    await client.query("UPDATE study_sessions SET pending_operation_started_at=now()-interval '11 minutes' WHERE id='55555555-5555-4555-8555-555555555555'")
    expect(await secondRepository.claimSessionOperation('55555555-5555-4555-8555-555555555555', 1, 'same-operation', tokenB)).toBe(1)
    expect(await firstRepository.renewSessionOperation('55555555-5555-4555-8555-555555555555', 1, tokenA)).toBe(false)
    const staleSession = await firstRepository.findSession('55555555-5555-4555-8555-555555555555')
    if (!staleSession) throw new Error('Sessão de integração ausente')
    expect(await firstRepository.completeSessionOperation({ ...staleSession, version: 2 }, 1, tokenA)).toBe(false)
    expect(await secondRepository.completeSessionOperation({ ...staleSession, version: 2 }, 1, tokenB)).toBe(true)

    await client.query('DROP TABLE public.schema_migrations')
    expect(await runMigrations(client, migrations)).toEqual({
      baselined: 12,
      applied: migrations.slice(12).map(({ name }) => name),
    })
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
