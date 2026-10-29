-- Distinguish immediate Study, focused Practice and delayed review attempts.
ALTER TABLE public.learning_evidence
  ADD COLUMN attempt_context text NOT NULL DEFAULT 'STUDY'
  CONSTRAINT learning_evidence_attempt_context_check
    CHECK (attempt_context IN ('STUDY','DRILL','REVIEW'));

UPDATE public.learning_evidence SET attempt_context='REVIEW' WHERE review_id IS NOT NULL;
