ALTER TABLE public.study_tasks DROP CONSTRAINT IF EXISTS study_tasks_status_check;
ALTER TABLE public.study_tasks ADD CONSTRAINT study_tasks_status_check
  CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'REMOVED'));
