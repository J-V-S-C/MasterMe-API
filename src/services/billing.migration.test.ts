import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const migrationUrl = new URL('../../migrations/014_infinitepay_billing.sql', import.meta.url)

describe('migração de billing', () => {
  test('mantém concessão, transação e idempotência protegidas por unicidade', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    expect(sql).toContain('UNIQUE (owner_id, idempotency_key_hash)')
    expect(sql).toContain('billing_entitlement_grants')
    expect(sql).toContain('order_id UUID PRIMARY KEY')
    expect(sql).toContain("WHERE event_type='PAYMENT_CONFIRMED'")
  })

  test('isola saldo e vigência por tier sem promover pacote inferior', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    const repository = await readFile(new URL('../repositories/postgres-billing.repository.ts', import.meta.url), 'utf8')
    expect(sql).toContain('PRIMARY KEY (owner_id, plan_id)')
    expect(repository).toContain('ON CONFLICT (owner_id,plan_id) DO UPDATE')
    expect(sql).toContain("ORDER BY CASE plan_id WHEN 'PRO' THEN 2 ELSE 1 END DESC")
    expect(sql).toContain('WHERE owner_id=p_owner_id AND plan_id=v_plan_id')
  })

  test('serializa admissão, preserva replay terminal e limita leases entre instâncias', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    const repository = await readFile(new URL('../repositories/postgres-billing.repository.ts', import.meta.url), 'utf8')
    expect(repository).toContain('pg_advisory_xact_lock')
    expect(repository).toContain('WHERE pending < 5 AND NOT EXISTS (SELECT 1 FROM existing)')
    expect(repository).toContain('ON CONFLICT (event_key) DO NOTHING')
    expect(repository).toContain("hashtextextended('billing-webhook-reconciliation'")
    expect(repository).toContain('SELECT DISTINCT ON (candidate.order_id)')
    expect(repository).toContain("lease_expires_at=now()+interval '5 minutes'")
    expect(sql).toContain('lease_token UUID')
    expect(sql).toContain('lease_expires_at TIMESTAMPTZ')
  })

  test('habilita RLS e não expõe a função de reserva à Data API', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    for (const table of [
      'billing_orders', 'billing_payment_events', 'billing_entitlement_grants', 'billing_entitlements',
      'ai_credit_daily_usage', 'ai_credit_monthly_usage', 'ai_credit_global_daily_usage', 'ai_credit_usage_events',
    ]) expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    expect(sql).toContain('REVOKE ALL ON FUNCTION reserve_ai_credits(UUID,TEXT,BIGINT,BOOLEAN) FROM PUBLIC')
  })

  test('mapeia pesos no banco e só atualiza consumos depois de validar todos os tetos', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    expect(sql).toContain("WHEN 'INITIAL_EVALUATION' THEN 2")
    expect(sql).toContain("WHEN 'EXTRACTION' THEN 12")
    expect(sql.indexOf("RETURN QUERY SELECT 'PERIOD_LIMIT'::TEXT")).toBeLessThan(sql.indexOf('UPDATE ai_credit_global_daily_usage'))
  })
})
