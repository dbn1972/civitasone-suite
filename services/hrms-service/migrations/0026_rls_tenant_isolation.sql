-- hrms-service RLS migration: tenant isolation backstop
-- Role: hrms_svc on civitas_hrms
-- Applied AFTER 0025_employee_status_contract.sql

CREATE OR REPLACE FUNCTION employee.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- ── employee schema ───────────────────────────────────────────────
ALTER TABLE employee.hrms_departments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_designations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_docs   ENABLE ROW LEVEL SECURITY;

ALTER TABLE employee.hrms_departments     FORCE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_designations    FORCE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employees       FORCE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_employee_docs   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_departments;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_designations;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employees;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_employee_docs;

CREATE POLICY tenant_isolation ON employee.hrms_departments   USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON employee.hrms_designations  USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON employee.hrms_employees     USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON employee.hrms_employee_docs USING (tenant_id = employee.current_tenant_id());

-- ── attendance schema ─────────────────────────────────────────────
ALTER TABLE attendance.hrms_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_attendance;
CREATE POLICY tenant_isolation ON attendance.hrms_attendance USING (tenant_id = employee.current_tenant_id());

-- ── leave schema ──────────────────────────────────────────────────
ALTER TABLE leave.hrms_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_requests;
CREATE POLICY tenant_isolation ON leave.hrms_leave_requests USING (tenant_id = employee.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = employee.current_tenant_id());
