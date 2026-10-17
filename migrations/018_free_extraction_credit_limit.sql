-- Allow a free account to reserve an extraction and one fallback in a day.
-- Historical migration 014 remains immutable; the monthly free cap stays at 120.
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

  v_daily_limit := CASE v_plan_id WHEN 'PRO' THEN 180 WHEN 'ESSENTIAL' THEN 120 ELSE 24 END;
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
