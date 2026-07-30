-- 0083_attendance_period_lock.sql
-- Attendance period lock / payroll cut-off (checklist T&A-ATM-0247, defect DEF-AT-001).
--   • attendance.hrms_attendance_locks — one row per (tenant, period YYYY-MM)
--     recording whether that attendance month is LOCKED (payroll has been cut off)
--     or re-OPENED. Once a period is locked, attendance marking and
--     regularisation for any date in that month are rejected (422 ATTENDANCE_LOCKED)
--     until an authorised officer re-opens it. Gives a tamper-evident who/when/why
--     trail (locked_by / locked_at / reason) for audit.
-- Additive + idempotent. FORCE RLS on app.tenant_id GUC.
--
-- Rollback: DROP TABLE IF EXISTS attendance.hrms_attendance_locks;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS attendance.hrms_attendance_locks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  period      char(7) NOT NULL,                       -- YYYY-MM
  status      varchar(8) NOT NULL DEFAULT 'locked',   -- locked | open
  reason      text,
  locked_by   uuid,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_attendance_locks_status_check
    CHECK (status IN ('locked','open')),
  CONSTRAINT hrms_attendance_locks_period_check
    CHECK (period ~ '^[0-9]{4}-[0-9]{2}$')
);

-- One lock row per (tenant, period) — the period is the stable business key.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_attendance_locks_period_uq
  ON attendance.hrms_attendance_locks (tenant_id, period);

ALTER TABLE attendance.hrms_attendance_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_attendance_locks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_attendance_locks_tenant_isolation ON attendance.hrms_attendance_locks;
CREATE POLICY hrms_attendance_locks_tenant_isolation ON attendance.hrms_attendance_locks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance.hrms_attendance_locks TO hrms_svc;
