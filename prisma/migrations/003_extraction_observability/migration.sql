ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS stage VARCHAR(16) NOT NULL DEFAULT 'QUEUED';
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS total_chunks INT NOT NULL DEFAULT 0;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS completed_chunks INT NOT NULL DEFAULT 0;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS progress_percent INT NOT NULL DEFAULT 0;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS phase_durations JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS processing_jobs_status_created_idx ON processing_jobs(status, created_at);
