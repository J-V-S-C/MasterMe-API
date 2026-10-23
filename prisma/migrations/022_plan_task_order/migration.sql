ALTER TABLE public.study_tasks
  ADD COLUMN sort_order integer NOT NULL DEFAULT 1000000
  CHECK (sort_order >= 0);
CREATE INDEX study_tasks_plan_order_idx ON public.study_tasks(owner_id, plan_id, sort_order, created_at);
