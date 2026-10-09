CREATE TABLE IF NOT EXISTS billing_orders (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('ESSENTIAL','PRO')),
  amount_in_cents INT NOT NULL CHECK (amount_in_cents > 0),
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CHECKOUT_READY','CHECKOUT_FAILED','PAID')),
  checkout_url TEXT,
  transaction_nsu TEXT,
  invoice_slug TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS billing_orders_owner_created_idx
  ON billing_orders(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_payment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('WEBHOOK_RECEIVED','PAYMENT_CONFIRMED')),
  event_key TEXT NOT NULL UNIQUE,
  transaction_nsu TEXT NOT NULL,
  invoice_slug TEXT NOT NULL,
  amount_in_cents INT NOT NULL CHECK (amount_in_cents >= 0),
  capture_method TEXT,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_confirmed_transaction_idx
  ON billing_payment_events(transaction_nsu) WHERE event_type='PAYMENT_CONFIRMED';
CREATE INDEX IF NOT EXISTS billing_payment_events_order_created_idx
  ON billing_payment_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_payment_events_pending_idx
  ON billing_payment_events(next_attempt_at, lease_expires_at, id)
  WHERE event_type='WEBHOOK_RECEIVED' AND processed_at IS NULL;

CREATE TABLE IF NOT EXISTS billing_entitlement_grants (
  order_id UUID PRIMARY KEY REFERENCES billing_orders(id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('ESSENTIAL','PRO')),
  credit_amount INT NOT NULL CHECK (credit_amount > 0),
  duration_days INT NOT NULL CHECK (duration_days > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_entitlements (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('ESSENTIAL','PRO')),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  credit_limit INT NOT NULL CHECK (credit_limit > 0),
  credits_used INT NOT NULL DEFAULT 0 CHECK (credits_used >= 0 AND credits_used <= credit_limit),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, plan_id),
  CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS billing_entitlements_valid_until_idx
  ON billing_entitlements(valid_until);

CREATE TABLE IF NOT EXISTS ai_credit_daily_usage (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  credits INT NOT NULL DEFAULT 0 CHECK (credits >= 0),
  PRIMARY KEY (owner_id, usage_date)
);

CREATE TABLE IF NOT EXISTS ai_credit_monthly_usage (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  credits INT NOT NULL DEFAULT 0 CHECK (credits >= 0),
  PRIMARY KEY (owner_id, month_start),
  CHECK (month_start = date_trunc('month', month_start)::date)
);

CREATE TABLE IF NOT EXISTS ai_credit_global_daily_usage (
  usage_date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  credits BIGINT NOT NULL DEFAULT 0 CHECK (credits >= 0)
);

CREATE TABLE IF NOT EXISTS ai_credit_usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN (
    'EXTRACTION','INITIAL_EVALUATION','EDGE_CASE_GENERATION','EDGE_CASE_EVALUATION',
    'PRACTICE_PROJECT','LOCALIZATION','STRESS_EVALUATION','ISOMORPHIC_PROBLEM'
  )),
  plan_id TEXT NOT NULL CHECK (plan_id IN ('FREE','ESSENTIAL','PRO')),
  credits INT NOT NULL CHECK (credits > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_credit_usage_events_owner_created_idx
  ON ai_credit_usage_events(owner_id, created_at DESC);

ALTER TABLE billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_global_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_usage_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_ai_credits(
  p_owner_id UUID,
  p_operation TEXT,
  p_global_daily_limit BIGINT,
  p_enabled BOOLEAN
) RETURNS TABLE(outcome TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weight INT;
  v_plan_id TEXT;
  v_daily_limit INT;
  v_period_limit INT;
  v_period_used INT;
  v_daily_used INT;
  v_global_used BIGINT;
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_month_start DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF NOT p_enabled THEN
    RETURN QUERY SELECT 'DISABLED'::TEXT;
    RETURN;
  END IF;
  IF p_global_daily_limit < 1 THEN
    RETURN QUERY SELECT 'GLOBAL_LIMIT'::TEXT;
    RETURN;
  END IF;

  v_weight := CASE p_operation
    WHEN 'INITIAL_EVALUATION' THEN 2
    WHEN 'STRESS_EVALUATION' THEN 2
    WHEN 'EDGE_CASE_GENERATION' THEN 4
    WHEN 'EDGE_CASE_EVALUATION' THEN 4
    WHEN 'ISOMORPHIC_PROBLEM' THEN 4
    WHEN 'LOCALIZATION' THEN 6
    WHEN 'PRACTICE_PROJECT' THEN 8
    WHEN 'EXTRACTION' THEN 12
    ELSE NULL
  END;
  IF v_weight IS NULL THEN
    RETURN QUERY SELECT 'INVALID_OPERATION'::TEXT;
    RETURN;
  END IF;

  INSERT INTO ai_credit_global_daily_usage (usage_date,credits)
    VALUES (v_today,0) ON CONFLICT (usage_date) DO NOTHING;
  SELECT credits INTO v_global_used FROM ai_credit_global_daily_usage
    WHERE usage_date=v_today FOR UPDATE;

  SELECT plan_id,credit_limit,credits_used
    INTO v_plan_id,v_period_limit,v_period_used
    FROM billing_entitlements
    WHERE owner_id=p_owner_id AND valid_until>now()
    ORDER BY CASE plan_id WHEN 'PRO' THEN 2 ELSE 1 END DESC, valid_until DESC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    v_plan_id := 'FREE';
    v_period_limit := 120;
    INSERT INTO ai_credit_monthly_usage (owner_id,month_start,credits)
      VALUES (p_owner_id,v_month_start,0)
      ON CONFLICT (owner_id,month_start) DO NOTHING;
    SELECT credits INTO v_period_used FROM ai_credit_monthly_usage
      WHERE owner_id=p_owner_id AND month_start=v_month_start
      FOR UPDATE;
  END IF;

  v_daily_limit := CASE v_plan_id WHEN 'PRO' THEN 180 WHEN 'ESSENTIAL' THEN 120 ELSE 10 END;
  INSERT INTO ai_credit_daily_usage (owner_id,usage_date,credits)
    VALUES (p_owner_id,v_today,0) ON CONFLICT (owner_id,usage_date) DO NOTHING;
  SELECT credits INTO v_daily_used FROM ai_credit_daily_usage
    WHERE owner_id=p_owner_id AND usage_date=v_today FOR UPDATE;

  IF v_global_used + v_weight > p_global_daily_limit THEN
    RETURN QUERY SELECT 'GLOBAL_LIMIT'::TEXT;
    RETURN;
  END IF;
  IF v_daily_used + v_weight > v_daily_limit THEN
    RETURN QUERY SELECT 'DAILY_LIMIT'::TEXT;
    RETURN;
  END IF;
  IF v_period_used + v_weight > v_period_limit THEN
    RETURN QUERY SELECT 'PERIOD_LIMIT'::TEXT;
    RETURN;
  END IF;

  UPDATE ai_credit_global_daily_usage SET credits=credits+v_weight WHERE usage_date=v_today;
  UPDATE ai_credit_daily_usage SET credits=credits+v_weight WHERE owner_id=p_owner_id AND usage_date=v_today;
  IF v_plan_id='FREE' THEN
    UPDATE ai_credit_monthly_usage SET credits=credits+v_weight
      WHERE owner_id=p_owner_id AND month_start=v_month_start;
  ELSE
    UPDATE billing_entitlements SET credits_used=credits_used+v_weight,updated_at=now()
      WHERE owner_id=p_owner_id AND plan_id=v_plan_id;
  END IF;
  INSERT INTO ai_credit_usage_events (owner_id,operation,plan_id,credits)
    VALUES (p_owner_id,p_operation,v_plan_id,v_weight);

  RETURN QUERY SELECT 'RESERVED'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION reserve_ai_credits(UUID,TEXT,BIGINT,BOOLEAN) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION reserve_ai_credits(UUID,TEXT,BIGINT,BOOLEAN) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION reserve_ai_credits(UUID,TEXT,BIGINT,BOOLEAN) FROM authenticated;
  END IF;
END $$;
