-- hrms-service RLS migration: tenant isolation backstop
-- Role: hrms_svc on civitas_hrms
-- Applied AFTER 0025_employee_status_contract.sql
--
-- FIXES (vs. original draft):
--   • leave section referenced hrms_leave_requests which does NOT exist;
--     the real table is hrms_leave_apps.  Corrected below.
--   • Added RLS for ALL leave schema tables (hrms_leave_types, hrms_leave_allocs,
--     hrms_leave_apps) — previously only a single (wrong) table was listed.
--   • Added RLS for recruitment schema (hrms_job_openings, hrms_applications,
--     hrms_offers) which was entirely absent.
--   • Added RLS for training schema (hrms_trainings, hrms_nominations).
--   • Added RLS for lifecycle schema (hrms_transfers, hrms_promotions,
--     hrms_separations).

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
-- NOTE: the original draft erroneously referenced hrms_leave_requests
-- (which does not exist). The correct table names are below.
ALTER TABLE leave.hrms_leave_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_allocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_apps   ENABLE ROW LEVEL SECURITY;

ALTER TABLE leave.hrms_leave_types  FORCE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_allocs FORCE ROW LEVEL SECURITY;
ALTER TABLE leave.hrms_leave_apps   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_types;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_allocs;
DROP POLICY IF EXISTS tenant_isolation ON leave.hrms_leave_apps;

CREATE POLICY tenant_isolation ON leave.hrms_leave_types  USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON leave.hrms_leave_allocs USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON leave.hrms_leave_apps   USING (tenant_id = employee.current_tenant_id());

-- ── recruitment schema ────────────────────────────────────────────
ALTER TABLE recruitment.hrms_job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_offers       ENABLE ROW LEVEL SECURITY;

ALTER TABLE recruitment.hrms_job_openings FORCE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE recruitment.hrms_offers       FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_job_openings;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_applications;
DROP POLICY IF EXISTS tenant_isolation ON recruitment.hrms_offers;

CREATE POLICY tenant_isolation ON recruitment.hrms_job_openings USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON recruitment.hrms_applications USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON recruitment.hrms_offers       USING (tenant_id = employee.current_tenant_id());

-- ── training schema ───────────────────────────────────────────────
ALTER TABLE training.hrms_trainings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_nominations ENABLE ROW LEVEL SECURITY;

ALTER TABLE training.hrms_trainings   FORCE ROW LEVEL SECURITY;
ALTER TABLE training.hrms_nominations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON training.hrms_trainings;
DROP POLICY IF EXISTS tenant_isolation ON training.hrms_nominations;

CREATE POLICY tenant_isolation ON training.hrms_trainings   USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON training.hrms_nominations USING (tenant_id = employee.current_tenant_id());

-- ── lifecycle schema ──────────────────────────────────────────────
ALTER TABLE lifecycle.hrms_transfers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_promotions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_separations ENABLE ROW LEVEL SECURITY;

ALTER TABLE lifecycle.hrms_transfers   FORCE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_promotions  FORCE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.hrms_separations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_transfers;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_promotions;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.hrms_separations;

CREATE POLICY tenant_isolation ON lifecycle.hrms_transfers   USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON lifecycle.hrms_promotions  USING (tenant_id = employee.current_tenant_id());
CREATE POLICY tenant_isolation ON lifecycle.hrms_separations USING (tenant_id = employee.current_tenant_id());

-- ── _outbox schema ────────────────────────────────────────────────
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = employee.current_tenant_id());
