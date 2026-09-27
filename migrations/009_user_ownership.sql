-- A autenticação inaugura um ambiente multiusuário. Os dados anônimos do MVP
-- não têm proprietário confiável e são descartados deliberadamente.
TRUNCATE TABLE study_materials, activity_events, ai_evaluation_cache, ai_usage_events RESTART IDENTITY CASCADE;

ALTER TABLE study_materials
  ADD COLUMN IF NOT EXISTS owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS study_materials_owner_created_idx
  ON study_materials(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_owner_id_idx
  ON activity_events(owner_id, id);

ALTER TABLE study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_confidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_evaluation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

-- O backend usa uma conexão PostgreSQL confiável e aplica ownership antes de
-- cada operação. Sem policies, a Data API não expõe estas tabelas aos clientes.
