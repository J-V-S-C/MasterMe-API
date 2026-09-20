CREATE TABLE IF NOT EXISTS ai_evaluation_cache (
  request_hash TEXT PRIMARY KEY,
  evaluation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_artifacts (
  id BIGSERIAL PRIMARY KEY,
  material_id UUID NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL,
  input_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, input_hash)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  operation VARCHAR(40) NOT NULL,
  model VARCHAR(120) NOT NULL,
  success BOOLEAN NOT NULL,
  input_tokens INT,
  output_tokens INT,
  error_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_at_idx ON ai_usage_events(created_at);
