-- 0158: employee.hrms_probation_extensions -- audit trail for probation-end
-- extensions (GAP-HR-CONFIRMATION-05).
--
-- Probation end was hard-coded to exactly dateOfJoining + 2 years everywhere
-- (lifecycle/m7-list-routes.ts's confirmations handler), with no way to
-- represent an extension -- the web card's "Extend" button has always been
-- permanently disabled ("not available in this release yet"). Per the HR
-- gap-remediation campaign's Day-0 decision packet (GAP-HR-CONFIRMATION-05):
-- "Make it configurable ... default 2 years, with an extension record +
-- reason." This table is that extension record; the unextended +2y default
-- computation is unchanged and stays inline where it already lived.
--
-- One row per recorded extension (a history, not a single mutable column):
-- an employee's *current* probation end is the newEndDate of their most
-- recent row here, else the unchanged +2y default. Both readers of this
-- table (services/hrms-service/src/modules/employee/repo.ts's
-- findCurrentProbationEnd, used by the new PATCH .../probation-extension
-- route's pre-check, and lifecycle/m7-list-routes.ts's confirmations list)
-- take "most recent by created_at" as authoritative.
--
-- Written only via the standard CQRS command/consumer path (employee/
-- routes.ts validates + publishes hrms.employee.probation.extend; employee/
-- consumer.ts's subscriber does the actual insert + audit event) -- never
-- from a route handler directly.
--
-- Who may record an extension: left at the same HR_ROLES gate as the
-- sibling .../confirm endpoint (hr_admin/hr_officer/super_admin) -- the
-- decision packet raised but did not answer "who's allowed to record an
-- extension"; flagged in this PR's description for explicit confirmation.
CREATE TABLE IF NOT EXISTS employee.hrms_probation_extensions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  employee_id        uuid        NOT NULL,
  previous_end_date  date        NOT NULL,
  new_end_date       date        NOT NULL,
  reason             text        NOT NULL,
  order_ref          text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hrms_probation_extensions_tenant_employee
  ON employee.hrms_probation_extensions (tenant_id, employee_id, created_at DESC);

ALTER TABLE employee.hrms_probation_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_probation_extensions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_probation_extensions;
CREATE POLICY tenant_isolation_policy ON employee.hrms_probation_extensions
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
