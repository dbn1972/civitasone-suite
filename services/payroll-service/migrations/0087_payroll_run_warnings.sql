-- 0087_payroll_run_warnings.sql
--
-- Payroll run warnings made visible. The run engine already records non-blocking
-- warnings (PT_STATE_UNKNOWN, PT_GENDER_UNKNOWN, HRA_FLOOR_NOT_CONFIGURED) as
-- audit events; nothing could read them back. This table persists them on the
-- run, written in the same transaction that computes the run (rebuilt whole on
-- every pass, like the register), so the run detail page and the runs list can
-- show them. The audit events are unchanged.
--   * code: the warning code; count: how many employees it affects (0 when it
--     is not employee-specific, e.g. HRA_FLOOR_NOT_CONFIGURED);
--   * sample: a capped (50) jsonb array of {employeeId, employeeNo} -- no PII
--     beyond the employee number.
-- One row per (run, code). FORCE RLS. Idempotent.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.payroll_run_warnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  run_id      UUID NOT NULL,
  code        VARCHAR(64) NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  sample      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_payroll_run_warnings_run_code UNIQUE (run_id, code)
);

CREATE INDEX IF NOT EXISTS ix_payroll_run_warnings_tenant_run
  ON payroll.payroll_run_warnings (tenant_id, run_id);

ALTER TABLE payroll.payroll_run_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_run_warnings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_run_warnings;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_run_warnings
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
