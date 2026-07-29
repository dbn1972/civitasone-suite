-- 0093_screening_override_maker_checker.sql
-- Maker-checker override of a screening decision (checklist R-RA-0111).
--   recruitment.hrms_screening_overrides — an HR admin REQUESTS a change to an
--   already-decided application (from_decision -> to_decision, with a reason);
--   a DIFFERENT admin approves or rejects it (separation of duties). Only on
--   approval is the application's decision actually changed. At most ONE pending
--   request per application at a time.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC (matches recruitment schema).
--
-- Rollback: DROP TABLE IF EXISTS recruitment.hrms_screening_overrides;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS recruitment.hrms_screening_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  application_id       uuid NOT NULL,
  job_opening_id       uuid NOT NULL,
  from_decision        varchar(16) NOT NULL,
  to_decision          varchar(16) NOT NULL,
  application_version  integer NOT NULL,
  reason_code          varchar(24),
  reason               text NOT NULL,
  status               varchar(12) NOT NULL DEFAULT 'pending',
  original_screened_by uuid,
  requested_by         uuid NOT NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_screening_overrides_status_check
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT hrms_screening_overrides_to_check
    CHECK (to_decision IN ('pending','eligible','ineligible','shortlisted','waitlisted','manual_review'))
);

CREATE INDEX IF NOT EXISTS hrms_screening_overrides_app_idx
  ON recruitment.hrms_screening_overrides (tenant_id, application_id, requested_at);

-- At most ONE pending override per application (business key; blocks duplicate
-- concurrent requests at the DB level, not just the app check).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_screening_overrides_pending_uq
  ON recruitment.hrms_screening_overrides (tenant_id, application_id) WHERE status = 'pending';

ALTER TABLE recruitment.hrms_screening_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_screening_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_screening_overrides_tenant_isolation ON recruitment.hrms_screening_overrides;
CREATE POLICY hrms_screening_overrides_tenant_isolation ON recruitment.hrms_screening_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment.hrms_screening_overrides TO hrms_svc;
