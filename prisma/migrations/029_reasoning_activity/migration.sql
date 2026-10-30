ALTER TABLE public.learning_evidence
  DROP CONSTRAINT IF EXISTS learning_evidence_activity_type_check;

ALTER TABLE public.learning_evidence
  ADD CONSTRAINT learning_evidence_activity_type_check
  CHECK (activity_type IN ('COMPREHENSION','REASONING','RELATION','APPLICATION','RETENTION'));
