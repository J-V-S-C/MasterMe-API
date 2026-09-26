ALTER TABLE concepts ADD COLUMN IF NOT EXISTS edge_case_question TEXT;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS edge_case_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS edge_case_challenge JSONB;

UPDATE study_sessions
SET edge_case_challenge = stress_test
WHERE edge_case_challenge IS NULL AND stress_test IS NOT NULL;

UPDATE study_sessions SET edge_case_status = CASE
  WHEN state = 'VALIDATED' THEN 'PASSED'
  WHEN state = 'AWAITING_STRESS_REPLY' THEN 'READY'
  WHEN state = 'RETRY_STRESS' THEN 'REVIEW'
  ELSE edge_case_status
END;

UPDATE study_sessions
SET state = 'EXPLANATION_PASSED'
WHERE state IN ('VALIDATED', 'AWAITING_STRESS_REPLY', 'RETRY_STRESS');
