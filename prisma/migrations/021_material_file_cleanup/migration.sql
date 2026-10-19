CREATE TABLE public.material_file_deletions (
  material_id uuid PRIMARY KEY,
  storage_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.material_file_deletions ENABLE ROW LEVEL SECURITY;
