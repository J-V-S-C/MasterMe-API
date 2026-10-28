-- Delayed retrieval and richer evidence. Additive only; existing attempts remain readable.
CREATE TABLE public.review_schedules (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  activity_type text NOT NULL DEFAULT 'RETENTION'
    CHECK (activity_type IN ('RETENTION')),
  due_at timestamptz NOT NULL,
  interval_days integer NOT NULL CHECK (interval_days BETWEEN 1 AND 365),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','CANCELLED')),
  last_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, concept_id, activity_type)
);
CREATE INDEX review_schedules_due_idx
  ON public.review_schedules(owner_id, status, due_at);

-- The application uses a trusted database role and enforces owner_id on every
-- query. Deny Supabase Data API access until explicit policies are designed.
ALTER TABLE public.review_schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_evidence
  ADD COLUMN assistance_level smallint NOT NULL DEFAULT 0
    CHECK (assistance_level BETWEEN 0 AND 4),
  ADD COLUMN solution_revealed boolean NOT NULL DEFAULT false,
  ADD COLUMN strength text,
  ADD COLUMN gap text,
  ADD COLUMN next_action text,
  ADD COLUMN evidence_quote text,
  ADD COLUMN missing_premises jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN logical_break text,
  ADD COLUMN review_id uuid;

ALTER TABLE public.study_tasks
  ADD COLUMN review_id uuid;

ALTER TABLE public.learning_evidence
  ADD CONSTRAINT learning_evidence_review_fkey
    FOREIGN KEY (review_id) REFERENCES public.review_schedules(id) ON DELETE SET NULL;

ALTER TABLE public.study_tasks
  ADD CONSTRAINT study_tasks_review_fkey
    FOREIGN KEY (review_id) REFERENCES public.review_schedules(id) ON DELETE SET NULL;

ALTER TABLE public.review_schedules
  ADD CONSTRAINT review_schedules_last_evidence_fkey
    FOREIGN KEY (last_evidence_id) REFERENCES public.learning_evidence(id) ON DELETE SET NULL;
