-- Wave 4 / cluster D discovery: attendance/schema.ts's hrmsOvertimeRequests
-- Drizzle table (backing every /v1/hrms/overtime-requests route, the
-- attendance_routes__2..4 f3-consumer cases, and repo.updateOvertimeStatus)
-- has never had a corresponding migration -- confirmed by grepping every
-- *.sql file in this directory for "hrms_overtime_requests": zero matches,
-- versus the unrelated legacy attendance.hrms_overtime table (0009) which
-- has a completely different shape (a per-day hours-summary row, not an
-- approval-workflow request). A fresh bootstrap-postgres.sh run (this
-- service's own provisioning path, used by both CI and this PR's test run)
-- therefore has no attendance.hrms_overtime_requests relation at all, so
-- every one of those routes/consumer cases would fail with
-- "relation does not exist" in any environment provisioned this way.
--
-- This is unrelated to the overtime approve/reject status-guard fix this PR
-- otherwise makes (routes.ts, repo.ts, f3-consumer.ts) -- it was discovered
-- only because that fix's required real-Postgres regression test needs the
-- table to exist to run at all. Flagged prominently in the PR description
-- for the orchestrator/reviewer rather than silently expanding scope.
--
-- Column shapes and RLS follow the established sibling table in this same
-- module, attendance.hrms_attendance_regularisations (0003 + 0034), which
-- this migration mirrors as closely as the two tables' shapes allow.

CREATE TABLE IF NOT EXISTS attendance.hrms_overtime_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  employee_id       uuid        NOT NULL,
  request_date      date        NOT NULL,
  hours_requested   numeric(4,2) NOT NULL,
  reason            text,
  status            varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  approved_by       uuid,
  approved_at       timestamptz,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hrms_overtime_requests_tenant_status
  ON attendance.hrms_overtime_requests(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_hrms_overtime_requests_employee_id
  ON attendance.hrms_overtime_requests(employee_id);

ALTER TABLE attendance.hrms_overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_overtime_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_overtime_requests;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_overtime_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
