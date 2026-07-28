-- 0075_screening_shortlist.sql
-- Screening & shortlisting (checklist R-RA-0106/0110/0111/0112/0113/0114/0119).
--   • hrms_applications gains the CURRENT screening decision + structured
--     rejection reason + a shortlist-freeze flag (for fast filtering).
--   • hrms_screening_events is the immutable audit trail of every screening
--     action (auto-screen / decision / override / shortlist / freeze) with the
--     acting user, decision, reason and remarks — the screening audit report.
-- Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_screening_events;
--           ALTER TABLE recruitment.hrms_applications DROP COLUMN IF EXISTS screening_decision, ...;

ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS screening_decision    varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS screening_reason_code varchar(24),
  ADD COLUMN IF NOT EXISTS screening_remarks     text,
  ADD COLUMN IF NOT EXISTS screened_by           uuid,
  ADD COLUMN IF NOT EXISTS screened_at           timestamptz,
  ADD COLUMN IF NOT EXISTS shortlist_frozen      boolean NOT NULL DEFAULT false;

ALTER TABLE recruitment.hrms_applications
  DROP CONSTRAINT IF EXISTS hrms_applications_screening_decision_check;
ALTER TABLE recruitment.hrms_applications
  ADD CONSTRAINT hrms_applications_screening_decision_check
    CHECK (screening_decision IN ('pending','eligible','ineligible','shortlisted','waitlisted','manual_review'));

CREATE INDEX IF NOT EXISTS hrms_applications_screening_idx
  ON recruitment.hrms_applications (tenant_id, job_opening_id, screening_decision);

CREATE TABLE IF NOT EXISTS recruitment.hrms_screening_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  job_opening_id uuid NOT NULL,
  action         varchar(16) NOT NULL,          -- auto_screen | decision | override | shortlist | freeze
  decision       varchar(16),
  reason_code    varchar(24),
  remarks        text,
  is_override    boolean NOT NULL DEFAULT false,
  actor_id       uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_screening_events_action_check
    CHECK (action IN ('auto_screen','decision','override','shortlist','freeze'))
);

CREATE INDEX IF NOT EXISTS hrms_screening_events_app_idx
  ON recruitment.hrms_screening_events (tenant_id, application_id, created_at);

-- RLS (FORCE, app.tenant_id GUC — matches the recruitment schema).
ALTER TABLE recruitment.hrms_screening_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_screening_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_screening_events_tenant_isolation ON recruitment.hrms_screening_events;
CREATE POLICY hrms_screening_events_tenant_isolation ON recruitment.hrms_screening_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_screening_events TO hrms_svc;
