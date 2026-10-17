-- A relation and both of its concepts must belong to the same material.
-- Keep the existing primary keys and add composite keys for native foreign keys.
ALTER TABLE public.concepts
  ADD CONSTRAINT concepts_id_material_id_key UNIQUE (id, material_id);

ALTER TABLE public.concept_relations
  ADD CONSTRAINT concept_relations_source_material_fkey
  FOREIGN KEY (from_concept_id, material_id)
  REFERENCES public.concepts(id, material_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.concept_relations
  ADD CONSTRAINT concept_relations_target_material_fkey
  FOREIGN KEY (to_concept_id, material_id)
  REFERENCES public.concepts(id, material_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.concept_relations
  VALIDATE CONSTRAINT concept_relations_source_material_fkey;
ALTER TABLE public.concept_relations
  VALIDATE CONSTRAINT concept_relations_target_material_fkey;

ALTER TABLE public.concept_relations
  DROP CONSTRAINT concept_relations_from_concept_id_fkey,
  DROP CONSTRAINT concept_relations_to_concept_id_fkey;
