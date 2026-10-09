import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import type { AiOperation } from '../config/llm'
import {
  BILLING_PLANS,
  type BillingOrder,
  type BillingRepository,
  type CreditBalance,
  type CreditPolicy,
  type PaidBillingPlanId,
} from '../domain/billing'
import { AppError } from '../services/errors'

const DatabaseDateSchema = z.coerce.date()
const BillingOrderRowSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  plan_id: z.enum(['ESSENTIAL', 'PRO']),
  amount_in_cents: z.coerce.number().int().nonnegative(),
  status: z.enum(['PENDING', 'CHECKOUT_READY', 'CHECKOUT_FAILED', 'PAID']),
  checkout_url: z.string().nullable(),
  transaction_nsu: z.string().nullable(),
  invoice_slug: z.string().nullable(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
})

const toOrder = (row: unknown): BillingOrder => {
  const value = BillingOrderRowSchema.parse(row)
  return {
    id: value.id,
    ownerId: value.owner_id,
    planId: value.plan_id,
    amountInCents: value.amount_in_cents,
    status: value.status,
    checkoutUrl: value.checkout_url,
    transactionNsu: value.transaction_nsu,
    invoiceSlug: value.invoice_slug,
    createdAt: DatabaseDateSchema.parse(value.created_at).toISOString(),
    updatedAt: DatabaseDateSchema.parse(value.updated_at).toISOString(),
  }
}

const orderColumns = 'id,owner_id,plan_id,amount_in_cents,status,checkout_url,transaction_nsu,invoice_slug,created_at,updated_at'
const isPaymentTransactionConflict = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const postgresError = error as { code?: unknown; constraint?: unknown }
  return postgresError.code === '23505' && (
    postgresError.constraint === 'billing_payment_confirmed_transaction_idx'
    || postgresError.constraint === 'billing_payment_events_event_key_key'
  )
}

export class PostgresBillingRepository implements BillingRepository {
  public constructor(private readonly pool: Pool) {}

  public async createOrGetOrder(input: { id: string; ownerId: string; planId: PaidBillingPlanId; amountInCents: number; idempotencyKeyHash: string }): Promise<{ order: BillingOrder; created: boolean }> {
    const inserted = await this.pool.query(
      `INSERT INTO billing_orders (id,owner_id,plan_id,amount_in_cents,idempotency_key_hash)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (owner_id,idempotency_key_hash) DO NOTHING
       RETURNING ${orderColumns}`,
      [input.id, input.ownerId, input.planId, input.amountInCents, input.idempotencyKeyHash],
    )
    if (inserted.rows[0]) return { order: toOrder(inserted.rows[0]), created: true }
    const existing = await this.pool.query(
      `SELECT ${orderColumns} FROM billing_orders WHERE owner_id=$1 AND idempotency_key_hash=$2`,
      [input.ownerId, input.idempotencyKeyHash],
    )
    if (!existing.rows[0]) throw new AppError(503, 'ORDER_STATE_UNAVAILABLE', 'Não foi possível confirmar o estado do pedido. Tente novamente.')
    return { order: toOrder(existing.rows[0]), created: false }
  }

  public async claimCheckout(orderId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE billing_orders SET status='PENDING',updated_at=now()
       WHERE id=$1 AND (status='CHECKOUT_FAILED' OR (status='PENDING' AND updated_at < now()-interval '5 minutes'))
       RETURNING id`,
      [orderId],
    )
    return result.rowCount === 1
  }

  public async setCheckoutReady(orderId: string, checkoutUrl: string): Promise<BillingOrder> {
    const result = await this.pool.query(
      `UPDATE billing_orders SET status='CHECKOUT_READY',checkout_url=$2,updated_at=now()
       WHERE id=$1 AND status='PENDING' RETURNING ${orderColumns}`,
      [orderId, checkoutUrl],
    )
    if (!result.rows[0]) throw new AppError(409, 'ORDER_STATE_CHANGED', 'O pedido mudou enquanto o checkout era criado.')
    return toOrder(result.rows[0])
  }

  public async setCheckoutFailed(orderId: string): Promise<void> {
    await this.pool.query("UPDATE billing_orders SET status='CHECKOUT_FAILED',updated_at=now() WHERE id=$1 AND status='PENDING'", [orderId])
  }

  public async findOrder(orderId: string): Promise<BillingOrder | undefined> {
    const result = await this.pool.query(`SELECT ${orderColumns} FROM billing_orders WHERE id=$1`, [orderId])
    return result.rows[0] ? toOrder(result.rows[0]) : undefined
  }

  public async findOrderForOwner(orderId: string, ownerId: string): Promise<BillingOrder | undefined> {
    const result = await this.pool.query(`SELECT ${orderColumns} FROM billing_orders WHERE id=$1 AND owner_id=$2`, [orderId, ownerId])
    return result.rows[0] ? toOrder(result.rows[0]) : undefined
  }

  public async recordWebhook(input: { orderId: string; eventKey: string; transactionNsu: string; invoiceSlug: string; amountInCents: number }): Promise<number> {
    let client: PoolClient | undefined = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,7319726342))', [input.orderId])
      const result = await client.query(
        `WITH existing AS MATERIALIZED (
           SELECT id FROM billing_payment_events WHERE order_id=$1::uuid AND event_key=$2
         ), admission AS MATERIALIZED (
           SELECT count(*) AS pending FROM billing_payment_events
           WHERE order_id=$1::uuid AND event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL
         ), inserted AS (
           INSERT INTO billing_payment_events (order_id,event_type,event_key,transaction_nsu,invoice_slug,amount_in_cents)
           SELECT $1::uuid,'WEBHOOK_RECEIVED',$2,$3,$4,$5 FROM admission
           WHERE pending < 5 AND NOT EXISTS (SELECT 1 FROM existing)
           ON CONFLICT (event_key) DO NOTHING
           RETURNING id
         )
         SELECT id FROM existing UNION ALL SELECT id FROM inserted LIMIT 1`,
        [input.orderId, input.eventKey, input.transactionNsu, input.invoiceSlug, input.amountInCents],
      )
      if (!result.rows[0]) throw new AppError(429, 'PAYMENT_WEBHOOK_BACKLOG', 'O pedido já possui confirmações pendentes.')
      await client.query('COMMIT')
      committed = true
      return Number(result.rows[0].id)
    } catch (error) {
      if (!committed && client) {
        try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
      }
      throw error
    } finally {
      client?.release()
    }
  }

  public async claimPendingWebhooks(limit: number) {
    let client: PoolClient | undefined = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('billing-webhook-reconciliation',7319726342))")
      const leaseToken = randomUUID()
      const result = await client.query(
        `WITH capacity AS MATERIALIZED (
           SELECT greatest(0,5-count(*))::int AS available
           FROM billing_payment_events
           WHERE event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL AND lease_expires_at>now()
         ), per_order AS MATERIALIZED (
           SELECT DISTINCT ON (candidate.order_id)
             candidate.id,candidate.order_id,candidate.next_attempt_at
           FROM billing_payment_events candidate
           WHERE candidate.event_type='WEBHOOK_RECEIVED'
             AND candidate.processed_at IS NULL
             AND candidate.attempts<12
             AND candidate.next_attempt_at<=now()
             AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at<=now())
             AND NOT EXISTS (
               SELECT 1 FROM billing_payment_events leased
               WHERE leased.order_id=candidate.order_id
                 AND leased.event_type='WEBHOOK_RECEIVED'
                 AND leased.processed_at IS NULL
                 AND leased.lease_expires_at>now()
             )
           ORDER BY candidate.order_id,candidate.next_attempt_at,candidate.id
         ), selected AS (
           SELECT event.id
           FROM per_order candidate
           JOIN billing_payment_events event ON event.id=candidate.id
           ORDER BY candidate.next_attempt_at,event.id
           FOR UPDATE OF event SKIP LOCKED
           LIMIT least($1,(SELECT available FROM capacity))
         )
         UPDATE billing_payment_events event SET
           attempts=event.attempts+1,
           next_attempt_at=now()+interval '1 minute',
           lease_token=$2::uuid,
           lease_expires_at=now()+interval '5 minutes'
         FROM selected WHERE event.id=selected.id
         RETURNING event.id,event.order_id,event.transaction_nsu,event.invoice_slug,event.attempts,event.lease_token`,
        [Math.max(1, Math.min(20, limit)), leaseToken],
      )
      await client.query('COMMIT')
      committed = true
      return result.rows.map((row) => ({
        id: Number(row.id),
        orderId: z.string().uuid().parse(row.order_id),
        transactionNsu: z.string().parse(row.transaction_nsu),
        invoiceSlug: z.string().parse(row.invoice_slug),
        attempts: Number(row.attempts),
        leaseToken: z.string().uuid().parse(row.lease_token),
      }))
    } catch (error) {
      if (!committed && client) {
        try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
      }
      throw error
    } finally {
      client?.release()
    }
  }

  public async finishWebhook(eventId: number, leaseToken: string, errorCode: string | null, retry: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE billing_payment_events SET
         processed_at=CASE WHEN $3 THEN processed_at ELSE now() END,
         last_error_code=$4,
         lease_token=NULL,
         lease_expires_at=NULL,
         next_attempt_at=CASE WHEN $3 THEN now()+(least(attempts,10)*interval '1 minute') ELSE next_attempt_at END
       WHERE id=$1 AND event_type='WEBHOOK_RECEIVED' AND lease_token=$2::uuid`,
      [eventId, leaseToken, retry, errorCode],
    )
  }

  public async confirmPayment(input: { orderId: string; transactionNsu: string; invoiceSlug: string; captureMethod: string }): Promise<BillingOrder> {
    let client: PoolClient | undefined = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const selected = await client.query(`SELECT ${orderColumns} FROM billing_orders WHERE id=$1 FOR UPDATE`, [input.orderId])
      if (!selected.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Pedido não encontrado.')
      const order = toOrder(selected.rows[0])
      if (order.status === 'PAID') {
        await client.query('COMMIT')
        committed = true
        return order
      }
      const duplicate = await client.query(
        "SELECT order_id FROM billing_payment_events WHERE transaction_nsu=$1 AND event_type='PAYMENT_CONFIRMED' LIMIT 1",
        [input.transactionNsu],
      )
      if (duplicate.rows[0] && duplicate.rows[0].order_id !== order.id) {
        throw new AppError(409, 'PAYMENT_ALREADY_USED', 'A transação já foi vinculada a outro pedido.')
      }
      const plan = BILLING_PLANS[order.planId]
      await client.query(
        `INSERT INTO billing_payment_events (order_id,event_type,event_key,transaction_nsu,invoice_slug,amount_in_cents,capture_method)
         VALUES ($1,'PAYMENT_CONFIRMED',$2,$3,$4,$5,$6)`,
        [order.id, `confirmed:${input.transactionNsu}`, input.transactionNsu, input.invoiceSlug, order.amountInCents, input.captureMethod],
      )
      const grant = await client.query(
        `INSERT INTO billing_entitlement_grants (order_id,owner_id,plan_id,credit_amount,duration_days)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
        [order.id, order.ownerId, order.planId, plan.periodCreditLimit, plan.durationDays],
      )
      if (grant.rowCount === 1) {
        await client.query(
          `INSERT INTO billing_entitlements (owner_id,plan_id,valid_from,valid_until,credit_limit,credits_used)
           VALUES ($1,$2,now(),now()+($3*interval '1 day'),$4,0)
           ON CONFLICT (owner_id,plan_id) DO UPDATE SET
             valid_from=CASE WHEN billing_entitlements.valid_until>now() THEN billing_entitlements.valid_from ELSE now() END,
             valid_until=greatest(now(),billing_entitlements.valid_until)+($3*interval '1 day'),
             credit_limit=CASE WHEN billing_entitlements.valid_until>now() THEN billing_entitlements.credit_limit+$4 ELSE $4 END,
             credits_used=CASE WHEN billing_entitlements.valid_until>now() THEN billing_entitlements.credits_used ELSE 0 END,
             updated_at=now()`,
          [order.ownerId, order.planId, plan.durationDays, plan.periodCreditLimit],
        )
      }
      const updated = await client.query(
        `UPDATE billing_orders SET status='PAID',transaction_nsu=$2,invoice_slug=$3,paid_at=now(),updated_at=now()
         WHERE id=$1 RETURNING ${orderColumns}`,
        [order.id, input.transactionNsu, input.invoiceSlug],
      )
      await client.query('COMMIT')
      committed = true
      return toOrder(updated.rows[0])
    } catch (error) {
      const paymentTransactionConflict = isPaymentTransactionConflict(error)
      if (!committed && client) {
        try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined }
      }
      if (paymentTransactionConflict) {
        throw new AppError(409, 'PAYMENT_ALREADY_USED', 'A transação já foi vinculada a outro pedido.')
      }
      throw error
    } finally {
      client?.release()
    }
  }

  public async reserveCredits(ownerId: string, operation: AiOperation, policy: CreditPolicy): Promise<void> {
    const result = await this.pool.query(
      'SELECT outcome FROM reserve_ai_credits($1,$2,$3,$4)',
      [ownerId, operation, policy.globalDailyLimit, policy.enabled],
    )
    const outcome = String(result.rows[0]?.outcome ?? 'UNAVAILABLE')
    if (outcome === 'RESERVED') return
    if (outcome === 'DISABLED') throw new AppError(503, 'AI_DISABLED', 'As operações de IA estão temporariamente pausadas.')
    if (outcome === 'GLOBAL_LIMIT') throw new AppError(503, 'AI_GLOBAL_LIMIT_REACHED', 'A capacidade diária de IA foi atingida. Tente novamente após a renovação.')
    if (outcome === 'DAILY_LIMIT') throw new AppError(429, 'AI_DAILY_CREDIT_LIMIT_REACHED', 'Seu limite diário de créditos foi atingido.')
    if (outcome === 'PERIOD_LIMIT') throw new AppError(429, 'AI_PERIOD_CREDIT_LIMIT_REACHED', 'Seu saldo de créditos do período foi atingido.')
    throw new AppError(503, 'AI_CREDIT_STATE_UNAVAILABLE', 'Não foi possível reservar créditos para esta operação.')
  }

  public async getCreditBalance(ownerId: string): Promise<CreditBalance> {
    const result = await this.pool.query(
      `SELECT e.plan_id,e.valid_from,e.valid_until,e.credit_limit,e.credits_used,
        coalesce(d.credits,0)::int AS daily_used,coalesce(m.credits,0)::int AS monthly_used,
        (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' AS daily_resets_at,
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS month_start
       FROM (SELECT $1::uuid AS owner_id) owner
       LEFT JOIN LATERAL (
         SELECT plan_id,valid_from,valid_until,credit_limit,credits_used
         FROM billing_entitlements
         WHERE owner_id=owner.owner_id AND valid_until>now()
         ORDER BY CASE plan_id WHEN 'PRO' THEN 2 ELSE 1 END DESC,valid_until DESC
         LIMIT 1
       ) e ON true
       LEFT JOIN ai_credit_daily_usage d ON d.owner_id=owner.owner_id AND d.usage_date=(now() AT TIME ZONE 'UTC')::date
       LEFT JOIN ai_credit_monthly_usage m ON m.owner_id=owner.owner_id AND m.month_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date`,
      [ownerId],
    )
    const row = z.object({
      plan_id: z.enum(['ESSENTIAL', 'PRO']).nullable(),
      valid_from: z.unknown().nullable(),
      valid_until: z.unknown().nullable(),
      credit_limit: z.coerce.number().int().nullable(),
      credits_used: z.coerce.number().int().nullable(),
      daily_used: z.coerce.number().int(),
      monthly_used: z.coerce.number().int(),
      daily_resets_at: z.unknown(),
      month_start: z.unknown(),
    }).parse(result.rows[0])
    const planId = row.plan_id ?? 'FREE'
    const plan = BILLING_PLANS[planId]
    const dailyUsed = row.daily_used
    const periodUsed = planId === 'FREE' ? row.monthly_used : (row.credits_used ?? 0)
    const periodLimit = planId === 'FREE' ? plan.periodCreditLimit : (row.credit_limit ?? plan.periodCreditLimit)
    const monthStart = DatabaseDateSchema.parse(row.month_start)
    const periodStartsAt = planId === 'FREE' ? monthStart : DatabaseDateSchema.parse(row.valid_from)
    const periodEndsAt = planId === 'FREE'
      ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
      : DatabaseDateSchema.parse(row.valid_until)
    return {
      planId,
      dailyLimit: plan.dailyCreditLimit,
      dailyUsed,
      dailyRemaining: Math.max(0, plan.dailyCreditLimit - dailyUsed),
      dailyResetsAt: DatabaseDateSchema.parse(row.daily_resets_at).toISOString(),
      periodLimit,
      periodUsed,
      periodRemaining: Math.max(0, periodLimit - periodUsed),
      periodStartsAt: periodStartsAt.toISOString(),
      periodEndsAt: periodEndsAt.toISOString(),
      validUntil: row.valid_until ? DatabaseDateSchema.parse(row.valid_until).toISOString() : null,
    }
  }
}
