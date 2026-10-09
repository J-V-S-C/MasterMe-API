CREATE INDEX IF NOT EXISTS study_sessions_concept_updated_idx
  ON study_sessions(concept_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_created_idx
  ON activity_events(created_at);

-- Eventos são um log de replay curto para reconexões SSE, não armazenamento
-- permanente. A limpeza é deliberadamente limitada a registros antigos.
DELETE FROM activity_events WHERE created_at < now() - interval '7 days';
