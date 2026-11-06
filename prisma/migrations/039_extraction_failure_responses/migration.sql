-- Keep the structured Gemini responses that led to a failed reduction.
-- This column is internal to the worker and is never returned by material APIs.
ALTER TABLE public.processing_jobs
ADD COLUMN failure_responses jsonb;
