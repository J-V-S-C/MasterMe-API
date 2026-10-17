ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ai_usage_events_owner_created_idx
  ON ai_usage_events(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_daily_quotas (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  requests INT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY (owner_id, usage_date)
);

ALTER TABLE ai_daily_quotas ENABLE ROW LEVEL SECURITY;
