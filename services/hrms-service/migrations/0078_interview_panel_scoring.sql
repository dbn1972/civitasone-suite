-- 0078_interview_panel_scoring.sql
-- Interview panel scoring (checklist R-RA-0144/0146/0147/0148).
--   • hrms_interviews gains the weighted scorecard TEMPLATE (competencies +
--     weights), a cut-off, and the consolidated panel score.
--   • hrms_interview_scores holds each interviewer's INDEPENDENT score (one row
--     per interviewer), so scores are captured separately and can be kept blind
--     until the interviewer submits their own.
-- Additive + idempotent. No new CHECK on hrms_interviews columns; the module
-- reuses the existing recommendation values on consolidation.
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_interview_scores;
--           ALTER TABLE recruitment.hrms_interviews DROP COLUMN IF EXISTS scorecard_template, ...;

ALTER TABLE recruitment.hrms_interviews
  ADD COLUMN IF NOT EXISTS scorecard_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cutoff_score       integer,
  ADD COLUMN IF NOT EXISTS panel_score        integer,
  ADD COLUMN IF NOT EXISTS consolidated_at    timestamptz;

CREATE TABLE IF NOT EXISTS recruitment.hrms_interview_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  interview_id   uuid NOT NULL,
  interviewer_id uuid NOT NULL,
  scores         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- competency -> awarded score
  overall_score  integer,
  comments       text,
  submitted      boolean NOT NULL DEFAULT false,
  submitted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One score row per interviewer per interview.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_interview_scores_uq
  ON recruitment.hrms_interview_scores (tenant_id, interview_id, interviewer_id);

-- RLS (FORCE, app.tenant_id GUC).
ALTER TABLE recruitment.hrms_interview_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interview_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_interview_scores_tenant_isolation ON recruitment.hrms_interview_scores;
CREATE POLICY hrms_interview_scores_tenant_isolation ON recruitment.hrms_interview_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_interview_scores TO hrms_svc;
