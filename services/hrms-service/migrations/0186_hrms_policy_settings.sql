-- 0186_hrms_policy_settings.sql
--
-- fin-hr-02: per-tenant HR policy values that are policy, not code, kept in one
-- small key/value table instead of one table per setting. Each key has a
-- zod-validated shape and a conservative default in application code
-- (modules/policy-settings/registry.ts); NO ROW == the default, so this
-- migration alone changes no behaviour. Keys in use:
--   wfh_eligibility   (GAP-HR-WFH-01)       gazetted / pay-level WFH exclusion
--   apar_deadlines    (GAP-HR-APAR-03)      APAR stage due-dates
--   dashboard_scope   (GAP-HR-DASHBOARD-08) what a manager-only viewer sees
--
-- Rollback: DROP TABLE IF EXISTS employee.hrms_policy_settings;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee.hrms_policy_settings (
  tenant_id   uuid         NOT NULL,
  key         varchar(64)  NOT NULL,
  value       jsonb        NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE employee.hrms_policy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_policy_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_policy_settings;
CREATE POLICY tenant_isolation_policy ON employee.hrms_policy_settings
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
