ALTER TABLE public.study_materials
  ADD COLUMN reading_offset integer NOT NULL DEFAULT 0
  CONSTRAINT study_materials_reading_offset_check CHECK (reading_offset >= 0);
