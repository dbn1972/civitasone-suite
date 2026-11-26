-- 0272: employee.hrms_confirmation_recommendations -- the reporting manager's
-- probation-confirmation recommendation (GAP-HR-CONFIRMATION-01).
--
-- Owner decision (26 Nov 2026): the REPORTING MANAGER records the recommendation
-- (recommended | not_recommended, with a remark); HR then confirms, and must give a
-- required override remark when no recommendation is on record (or it is
-- not_recommended). Nothing is hard-blocked.
--
-- One row per recommendation recorded -- a history, not a single mutable column (so a
-- manager changing their mind keeps the earlier one in the record). The employee's CURRENT
-- recommendation is the row with the latest created_at. Written only through the CQRS
-- command/consumer path (hrms.employee.confirmation_recommend), never from a route handler.
--
-- Additive and idempotent; nothing existing reads or depends on it. Rollback:
--   DROP TABLE IF EXISTS employee.hrms_confirmation_recommendations;
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_confirmation_recommendations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL,
  employee_id     uuid         NOT NULL,
  recommendation  varchar(20)  NOT NULL,
  remark          text,
  recorded_by     uuid         NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid         NOT NULL,
  updated_by      uuid         NOT NULL,
  version         integer      NOT NULL DEFAULT 1,
  CONSTRAINT hrms_confirmation_recommendations_value_chk
    CHECK (recommendation IN ('recommended', 'not_recommended'))
);

CREATE INDEX IF NOT EXISTS idx_hrms_confirmation_recommendations_tenant_employee
  ON employee.hrms_confirmation_recommendations (tenant_id, employee_id, created_at DESC);

ALTER TABLE employee.hrms_confirmation_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_confirmation_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_confirmation_recommendations;
CREATE POLICY tenant_isolation_policy ON employee.hrms_confirmation_recommendations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON employee.hrms_confirmation_recommendations TO hrms_svc;
  END IF;
END $$;
