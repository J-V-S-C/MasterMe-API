-- A migração antiga apagava dados anônimos para inaugurar o ambiente
-- multiusuário. Migrações de produção nunca devem destruir dados: instalações
-- legadas com registros sem proprietário exigem reconciliação manual explícita.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM study_materials LIMIT 1)
    OR EXISTS (SELECT 1 FROM activity_events LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_evaluation_cache LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_usage_events LIMIT 1) THEN
    RAISE EXCEPTION 'Migração 009 bloqueada: existem dados sem proprietário; reconcilie-os antes de continuar.';
  END IF;
END $$;

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
