ALTER TABLE study_materials
  ADD COLUMN IF NOT EXISTS locale VARCHAR(10) NOT NULL DEFAULT 'pt-BR';

ALTER TABLE concepts
  ADD COLUMN IF NOT EXISTS generated_locale VARCHAR(10) NOT NULL DEFAULT 'und';

ALTER TABLE study_materials
  DROP CONSTRAINT IF EXISTS study_materials_locale_check;
ALTER TABLE study_materials
  ADD CONSTRAINT study_materials_locale_check CHECK (locale IN ('pt-BR', 'en-US'));

ALTER TABLE concepts
  DROP CONSTRAINT IF EXISTS concepts_generated_locale_check;
ALTER TABLE concepts
  ADD CONSTRAINT concepts_generated_locale_check CHECK (generated_locale IN ('pt-BR', 'en-US', 'und'));
