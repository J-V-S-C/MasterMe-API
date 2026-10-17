ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS pending_operation_hash TEXT,
  ADD COLUMN IF NOT EXISTS pending_operation_token UUID,
  ADD COLUMN IF NOT EXISTS pending_operation_started_at TIMESTAMPTZ;

ALTER TABLE study_sessions
  DROP CONSTRAINT IF EXISTS study_sessions_pending_operation_check;
ALTER TABLE study_sessions
  ADD CONSTRAINT study_sessions_pending_operation_check CHECK (
    (pending_operation_hash IS NULL) = (pending_operation_started_at IS NULL)
    AND (pending_operation_hash IS NULL) = (pending_operation_token IS NULL)
  );
