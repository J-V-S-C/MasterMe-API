-- Additive MasterMe 2.0 records. Existing sessions, concepts and material rows remain untouched.
CREATE TABLE public.material_units (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text,
  level smallint NOT NULL CHECK (level BETWEEN 0 AND 6),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset >= start_offset),
  provenance text NOT NULL CHECK (provenance IN ('HEADING','PDF_OUTLINE','UNSTRUCTURED')),
  page_number integer CHECK (page_number > 0),
  UNIQUE(material_id, ordinal)
);

CREATE TABLE public.concept_relations (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  from_concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  to_concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN ('REQUIRES','ENABLES','CONTRASTS','APPLIES_TO','PART_OF')),
  statement text NOT NULL,
  justification text NOT NULL,
  source_excerpt text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('EXTRACTED','STUDENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_concept_id <> to_concept_id)
);
CREATE INDEX concept_relations_material_idx ON public.concept_relations(material_id);
CREATE UNIQUE INDEX concept_relations_unique_idx ON public.concept_relations(material_id, from_concept_id, to_concept_id, relation_type);

CREATE TABLE public.shelves (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);
CREATE TABLE public.shelf_materials (
  shelf_id uuid NOT NULL REFERENCES public.shelves(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  PRIMARY KEY(shelf_id, material_id)
);
CREATE TABLE public.concept_cards (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, concept_id)
);

CREATE TABLE public.learning_goals (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  deadline date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.study_plans (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.learning_goals(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.study_tasks (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.study_plans(id) ON DELETE SET NULL,
  material_id uuid REFERENCES public.study_materials(id) ON DELETE SET NULL,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.material_units(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  activity_type text NOT NULL CHECK (activity_type IN ('READ','EXPLAIN','RELATE','APPLY','REVISIT','PRACTICE')),
  duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 480),
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','REMOVED')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_tasks_owner_schedule_idx ON public.study_tasks(owner_id, scheduled_at);

CREATE TABLE public.study_availability (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  minutes integer NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  timezone text NOT NULL,
  PRIMARY KEY(owner_id, weekday)
);

CREATE TABLE public.learning_evidence (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  relation_id uuid REFERENCES public.concept_relations(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.study_tasks(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('COMPREHENSION','RELATION','APPLICATION','RETENTION')),
  prompt text NOT NULL,
  answer text NOT NULL,
  status text NOT NULL CHECK (status IN ('SELF_REPORTED','PASSED','INCOMPLETE','LOGICAL_BREAK','CONTESTED')),
  assisted boolean NOT NULL DEFAULT false,
  diagnosis text NOT NULL DEFAULT '',
  source_excerpt text NOT NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learning_evidence_owner_created_idx ON public.learning_evidence(owner_id, created_at DESC);
CREATE UNIQUE INDEX learning_evidence_request_idx ON public.learning_evidence(owner_id, request_id);

CREATE TABLE public.activity_requests (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','DONE')),
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  evidence_id uuid REFERENCES public.learning_evidence(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, request_id)
);

CREATE TABLE public.evidence_contestations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES public.learning_evidence(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_contestations_evidence_idx ON public.evidence_contestations(evidence_id);

CREATE TABLE public.study_suggestions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES public.learning_evidence(id) ON DELETE CASCADE,
  concept_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  title text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','IGNORED')),
  task_id uuid REFERENCES public.study_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, evidence_id)
);

-- The application uses a trusted database role and enforces owner_id on every
-- query. Deny Supabase Data API access to these tables until explicit policies
-- are designed; this matches the existing 009 ownership migration.
ALTER TABLE public.material_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelf_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_contestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_suggestions ENABLE ROW LEVEL SECURITY;
