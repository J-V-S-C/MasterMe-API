-- Preserve completed chapter output within a book extraction job.
CREATE TABLE public.processing_job_units (
  job_id uuid NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.material_units(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, unit_id)
);

ALTER TABLE public.processing_job_units ENABLE ROW LEVEL SECURITY;
