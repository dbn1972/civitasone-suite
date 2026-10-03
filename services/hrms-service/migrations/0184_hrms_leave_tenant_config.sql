-- 0184_hrms_leave_tenant_config.sql
--
-- GAP-HR-LEAVE-APPLY-05: per-tenant switch for half-day CL and short leave.
-- No row == both OFF (today's behaviour: whole days only), so this migration
-- alone changes nothing for any tenant.
--
-- Rollback: DROP TABLE IF EXISTS leave.hrms_leave_tenant_config;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS leave.hrms_leave_tenant_config (
  tenant_id           uuid        PRIMARY KEY,
  half_day_enabled    boolean     NOT NULL DEFAULT false,
  short_leave_enabled boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1
);

ALTER TABLE leave.hrms_leave_tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_tenant_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_leave_tenant_config;
CREATE POLICY tenant_isolation_policy ON leave.hrms_leave_tenant_config
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
