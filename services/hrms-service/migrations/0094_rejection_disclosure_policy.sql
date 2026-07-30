-- 0094_rejection_disclosure_policy.sql
-- Candidate rejection communication policy (checklist R-RA-0118).
--   recruitment.hrms_job_openings gains disclose_rejection_reason — when true,
--   a candidate-facing rejection notice may include the high-level reason
--   CATEGORY (never internal scores/remarks/ranks). Default false (fail closed:
--   disclose nothing unless the vacancy explicitly opts in).
-- Additive + idempotent.
--
-- Rollback: ALTER TABLE recruitment.hrms_job_openings DROP COLUMN IF EXISTS disclose_rejection_reason;

SET lock_timeout = '5s';

ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS disclose_rejection_reason boolean NOT NULL DEFAULT false;
