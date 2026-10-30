-- Link optional Practice project work without changing task state or evidence.
ALTER TABLE public.study_tasks
  ADD COLUMN project_id uuid REFERENCES public.practice_projects(id) ON DELETE SET NULL;

ALTER TABLE public.study_tasks
  ADD CONSTRAINT study_tasks_project_requires_material_check
  CHECK (project_id IS NULL OR material_id IS NOT NULL);

CREATE INDEX study_tasks_owner_project_idx ON public.study_tasks(owner_id, project_id)
  WHERE project_id IS NOT NULL;
