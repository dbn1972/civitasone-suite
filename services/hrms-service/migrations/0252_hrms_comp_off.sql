-- 0252_hrms_comp_off.sql
--
-- V4-B-01: comp-off was an in-process array (lost on restart, per-replica,
-- invisible to the worker). Persist it in a tenant-scoped table.
--
-- Rollback: DROP TABLE IF EXISTS leave.hrms_comp_off;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS leave.hrms_comp_off (
  id           uuid        PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  employee_id  uuid        NOT NULL,
  worked_date  date        NOT NULL,
  holiday_name text        NOT NULL,
  hours        integer     NOT NULL CHECK (hours BETWEEN 1 AND 24),
  reason       text        NOT NULL DEFAULT '',
  status       text        NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'redeemed', 'expired')),
  redeemed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  updated_by   uuid        NOT NULL,
  version      integer     NOT NULL DEFAULT 1
);

-- One comp-off per employee per worked day (a replayed/double-submitted grant
-- must not mint a second entitlement).
CREATE UNIQUE INDEX IF NOT EXISTS hrms_comp_off_emp_day_uniq
  ON leave.hrms_comp_off (tenant_id, employee_id, worked_date);
CREATE INDEX IF NOT EXISTS hrms_comp_off_tenant_emp_status_idx
  ON leave.hrms_comp_off (tenant_id, employee_id, status);

ALTER TABLE leave.hrms_comp_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_comp_off FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON leave.hrms_comp_off;
CREATE POLICY tenant_isolation_policy ON leave.hrms_comp_off
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
