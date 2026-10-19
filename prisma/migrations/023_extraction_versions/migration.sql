-- A completed processing job is an extraction version. Existing concepts and
-- relations belong to the legacy version (NULL) and remain for study history.
ALTER TABLE public.study_materials
  ADD COLUMN active_extraction_job_id uuid;

ALTER TABLE public.concepts
  ADD COLUMN extraction_job_id uuid;

ALTER TABLE public.concept_relations
  ADD COLUMN extraction_job_id uuid;

CREATE INDEX concepts_material_extraction_idx
  ON public.concepts(material_id, extraction_job_id);
CREATE INDEX concept_relations_material_extraction_idx
  ON public.concept_relations(material_id, extraction_job_id);
