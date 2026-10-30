-- Immutable objectives and answered question snapshots. Legacy evidence keeps null links.
CREATE TABLE public.learning_objectives (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL,
  concept_id uuid NOT NULL UNIQUE,
  objective_text text NOT NULL,
  source_excerpt text NOT NULL,
  source_offset integer,
  extraction_job_id uuid,
  generator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_objectives_concept_material_fkey
    FOREIGN KEY (concept_id, material_id) REFERENCES public.concepts(id, material_id) ON DELETE CASCADE,
  CONSTRAINT learning_objectives_concept_material_key UNIQUE (concept_id, material_id),
  CONSTRAINT learning_objectives_id_material_key UNIQUE (id, material_id)
);

CREATE TABLE public.question_versions (
  id uuid PRIMARY KEY,
  objective_id uuid NOT NULL,
  material_id uuid NOT NULL,
  activity_type text NOT NULL,
  prompt text NOT NULL,
  prompt_version text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_excerpt text NOT NULL,
  source_offset integer,
  content_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_versions_objective_material_fkey
    FOREIGN KEY (objective_id, material_id) REFERENCES public.learning_objectives(id, material_id) ON DELETE CASCADE,
  CONSTRAINT question_versions_objective_hash_key UNIQUE (objective_id, content_hash)
);

ALTER TABLE public.learning_evidence
  ADD COLUMN question_version_id uuid REFERENCES public.question_versions(id) ON DELETE SET NULL;

CREATE INDEX learning_evidence_question_version_idx ON public.learning_evidence(question_version_id)
  WHERE question_version_id IS NOT NULL;
CREATE INDEX question_versions_material_created_idx ON public.question_versions(material_id, created_at DESC);

ALTER TABLE public.learning_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_versions ENABLE ROW LEVEL SECURITY;
