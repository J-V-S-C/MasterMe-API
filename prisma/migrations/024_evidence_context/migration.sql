ALTER TABLE public.learning_evidence
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN hints_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN previous_evidence_id uuid;

ALTER TABLE public.learning_evidence
  ADD CONSTRAINT learning_evidence_id_owner_material_key UNIQUE (id, owner_id, material_id),
  ADD CONSTRAINT learning_evidence_previous_owner_material_fkey
    FOREIGN KEY (previous_evidence_id, owner_id, material_id)
    REFERENCES public.learning_evidence(id, owner_id, material_id)
    ON DELETE SET NULL (previous_evidence_id);

CREATE INDEX learning_evidence_previous_idx
  ON public.learning_evidence(previous_evidence_id)
  WHERE previous_evidence_id IS NOT NULL;
