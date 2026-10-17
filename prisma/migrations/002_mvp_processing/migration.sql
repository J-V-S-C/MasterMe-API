ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'TEXT';
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS processing_status VARCHAR(16) NOT NULL DEFAULT 'READY';
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS processing_error TEXT;
ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY, material_id UUID NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'PENDING', attempts INT NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(), locked_at TIMESTAMPTZ, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_active_material_type ON processing_jobs(material_id,type) WHERE status IN ('PENDING','PROCESSING');
CREATE TABLE IF NOT EXISTS activity_events (
  id BIGSERIAL PRIMARY KEY, type VARCHAR(64) NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
