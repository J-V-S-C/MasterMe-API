CREATE TABLE IF NOT EXISTS concept_confidences (
  concept_id UUID PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_projects (
  id UUID PRIMARY KEY,
  material_id UUID NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL UNIQUE,
  focus_mode VARCHAR(24) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS practice_projects_material_created_idx
  ON practice_projects(material_id, created_at DESC);
