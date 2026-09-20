CREATE TABLE IF NOT EXISTS study_materials (
  id UUID PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
  id UUID PRIMARY KEY,
  material_id UUID NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  source_excerpt TEXT NOT NULL,
  fundamental_premises JSONB NOT NULL,
  edge_cases JSONB NOT NULL,
  prerequisite_ids JSONB NOT NULL,
  next_ids JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id UUID PRIMARY KEY,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  state VARCHAR(32) NOT NULL,
  question JSONB NOT NULL,
  stress_test JSONB,
  attempts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS concepts_material_id_idx ON concepts(material_id);
CREATE INDEX IF NOT EXISTS study_sessions_concept_id_idx ON study_sessions(concept_id);
