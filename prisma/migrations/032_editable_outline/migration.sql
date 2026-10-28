-- Keep imported headings and source order when a learner corrects an outline.
ALTER TABLE public.material_units
  ADD COLUMN original_title text,
  ADD COLUMN original_ordinal integer;

UPDATE public.material_units
SET original_title = title, original_ordinal = ordinal;

ALTER TABLE public.material_units DROP CONSTRAINT material_units_provenance_check;
ALTER TABLE public.material_units
  ADD CONSTRAINT material_units_provenance_check
  CHECK (provenance IN ('HEADING', 'PDF_OUTLINE', 'UNSTRUCTURED', 'STUDENT'));

ALTER TABLE public.study_materials
  ADD COLUMN outline_revision integer NOT NULL DEFAULT 0
  CONSTRAINT study_materials_outline_revision_check CHECK (outline_revision >= 0);
