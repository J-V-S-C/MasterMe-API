-- Source offsets are UTF-16 positions in study_materials.content. Legacy rows
-- remain nullable because a repeated excerpt cannot be located unambiguously.
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_offset INTEGER;
ALTER TABLE concept_relations ADD COLUMN IF NOT EXISTS source_offset INTEGER;
ALTER TABLE learning_evidence ADD COLUMN IF NOT EXISTS source_offset INTEGER;

ALTER TABLE concepts ADD CONSTRAINT concepts_source_offset_nonnegative CHECK (source_offset IS NULL OR source_offset >= 0);
ALTER TABLE concept_relations ADD CONSTRAINT concept_relations_source_offset_nonnegative CHECK (source_offset IS NULL OR source_offset >= 0);
ALTER TABLE learning_evidence ADD CONSTRAINT learning_evidence_source_offset_nonnegative CHECK (source_offset IS NULL OR source_offset >= 0);
