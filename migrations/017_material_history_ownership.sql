-- Deleting a material removes its linked tasks and learning evidence.
-- Composite foreign keys also prevent another owner from linking these records.
ALTER TABLE public.study_materials
  ADD CONSTRAINT study_materials_id_owner_id_key UNIQUE (id, owner_id);

ALTER TABLE public.study_tasks
  ADD CONSTRAINT study_tasks_material_owner_fkey
  FOREIGN KEY (material_id, owner_id)
  REFERENCES public.study_materials(id, owner_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.study_tasks
  VALIDATE CONSTRAINT study_tasks_material_owner_fkey;
ALTER TABLE public.study_tasks
  DROP CONSTRAINT study_tasks_material_id_fkey;
ALTER TABLE public.study_tasks
  ADD CONSTRAINT study_tasks_content_requires_material_check
  CHECK ((concept_id IS NULL AND unit_id IS NULL) OR material_id IS NOT NULL) NOT VALID;
ALTER TABLE public.study_tasks
  VALIDATE CONSTRAINT study_tasks_content_requires_material_check;

ALTER TABLE public.learning_evidence
  ADD CONSTRAINT learning_evidence_material_owner_fkey
  FOREIGN KEY (material_id, owner_id)
  REFERENCES public.study_materials(id, owner_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.learning_evidence
  VALIDATE CONSTRAINT learning_evidence_material_owner_fkey;
ALTER TABLE public.learning_evidence
  DROP CONSTRAINT learning_evidence_material_id_fkey;
