-- Keep the text and outline used by earlier extraction jobs when a PDF's
-- derived text index is repaired. The original uploaded file is unchanged.
CREATE TABLE public.material_source_snapshots (
  extraction_job_id uuid PRIMARY KEY REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.study_materials(id) ON DELETE CASCADE,
  content text NOT NULL,
  outline jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_source_snapshots_material_idx ON public.material_source_snapshots(material_id);
ALTER TABLE public.material_source_snapshots ENABLE ROW LEVEL SECURITY;
