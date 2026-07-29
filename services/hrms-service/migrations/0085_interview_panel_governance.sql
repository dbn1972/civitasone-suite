-- 0085_interview_panel_governance.sql
-- Interview management — panel constitution + outcome governance
-- (checklist R-RA-0137/0138/0149/0150).
--   • Extend interview stages (add domain / behavioural / presentation /
--     final_selection) — R-RA-0137.
--   • hrms_interview_panelists: the constituted panel with role, availability and a
--     conflict-of-interest declaration + recusal — R-RA-0138.
--   • hrms_interviews gains a structured outcome (recommend / waitlist / reject with
--     reason + validity period) — R-RA-0149/0150.
-- Additive + idempotent. Extends the existing recruitment.hrms_interviews (0078).
--
-- Rollback: DROP TABLE recruitment.hrms_interview_panelists;
--           ALTER TABLE recruitment.hrms_interviews DROP COLUMN outcome_status, ...;

-- R-RA-0137: widen the interview-stage vocabulary.
ALTER TABLE recruitment.hrms_interviews
  DROP CONSTRAINT IF EXISTS hrms_interviews_round_type_check;
ALTER TABLE recruitment.hrms_interviews
  ADD CONSTRAINT hrms_interviews_round_type_check
  CHECK (round_type IN ('screening','technical','hr','panel','final','group_discussion',
                        'domain','behavioural','presentation','final_selection'));

-- R-RA-0149/0150: structured outcome on the interview.
ALTER TABLE recruitment.hrms_interviews
  ADD COLUMN IF NOT EXISTS outcome_status           varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason         varchar(32),
  ADD COLUMN IF NOT EXISTS rejection_note           text,
  ADD COLUMN IF NOT EXISTS waitlist_rank            integer,
  ADD COLUMN IF NOT EXISTS recommendation_valid_until date,
  ADD COLUMN IF NOT EXISTS outcome_by               uuid,
  ADD COLUMN IF NOT EXISTS outcome_at               timestamptz;

ALTER TABLE recruitment.hrms_interviews
  DROP CONSTRAINT IF EXISTS hrms_interviews_outcome_status_check;
ALTER TABLE recruitment.hrms_interviews
  ADD CONSTRAINT hrms_interviews_outcome_status_check
  CHECK (outcome_status IN ('pending','recommended','waitlisted','rejected'));

ALTER TABLE recruitment.hrms_interviews
  DROP CONSTRAINT IF EXISTS hrms_interviews_rejection_reason_check;
ALTER TABLE recruitment.hrms_interviews
  ADD CONSTRAINT hrms_interviews_rejection_reason_check
  CHECK (rejection_reason IS NULL OR rejection_reason IN
    ('low_score','technical_unsuitability','communication','behavioural_fit','withdrawal','no_show'));

-- R-RA-0138: the constituted panel with COI + recusal.
CREATE TABLE IF NOT EXISTS recruitment.hrms_interview_panelists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  interview_id  uuid NOT NULL,
  member_id     uuid NOT NULL,
  member_name   varchar(256) NOT NULL,
  panel_role    varchar(24) NOT NULL DEFAULT 'member',   -- chair | member | observer | technical_expert | domain_expert
  availability  jsonb NOT NULL DEFAULT '{}'::jsonb,
  coi_declared  boolean NOT NULL DEFAULT false,
  coi_type      varchar(24) NOT NULL DEFAULT 'none',      -- none | relative | known_associate | financial | prior_association | other
  coi_note      text,
  recused       boolean NOT NULL DEFAULT false,
  recused_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_interview_panelists_role_check
    CHECK (panel_role IN ('chair','member','observer','technical_expert','domain_expert')),
  CONSTRAINT hrms_interview_panelists_coi_check
    CHECK (coi_type IN ('none','relative','known_associate','financial','prior_association','other')),
  CONSTRAINT hrms_interview_panelists_uq UNIQUE (interview_id, member_id)
);
CREATE INDEX IF NOT EXISTS hrms_interview_panelists_iv_idx
  ON recruitment.hrms_interview_panelists (tenant_id, interview_id);

ALTER TABLE recruitment.hrms_interview_panelists ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_interview_panelists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_interview_panelists_tenant_isolation ON recruitment.hrms_interview_panelists;
CREATE POLICY hrms_interview_panelists_tenant_isolation ON recruitment.hrms_interview_panelists
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_interview_panelists TO hrms_svc;
