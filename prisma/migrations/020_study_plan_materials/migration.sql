ALTER TABLE public.study_plans
  ADD CONSTRAINT study_plans_id_owner_id_key UNIQUE (id, owner_id);

CREATE TABLE public.study_plan_materials (
  plan_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  material_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (plan_id, material_id),
  UNIQUE (plan_id, ordinal),
  CONSTRAINT study_plan_materials_plan_owner_fkey FOREIGN KEY (plan_id, owner_id)
    REFERENCES public.study_plans(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT study_plan_materials_material_owner_fkey FOREIGN KEY (material_id, owner_id)
    REFERENCES public.study_materials(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX study_plan_materials_owner_idx ON public.study_plan_materials(owner_id);
ALTER TABLE public.study_plan_materials ENABLE ROW LEVEL SECURITY;
