-- Classify new imports without changing legacy source content or study history.
ALTER TABLE public.study_materials
  ADD COLUMN material_kind text
  CONSTRAINT study_materials_material_kind_check
    CHECK (material_kind IN ('BOOK', 'ARTICLE', 'TEXT'));
