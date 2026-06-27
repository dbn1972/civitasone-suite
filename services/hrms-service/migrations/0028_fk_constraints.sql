-- 0028_fk_constraints.sql
-- Purpose: Add missing FK constraints, CHECK constraints, and a unique partial
--          index to enforce referential integrity across HRMS schemas.
--
-- All statements use DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (or CREATE INDEX
-- IF NOT EXISTS) to make this migration fully idempotent.
--
-- FK strategy: ON DELETE CASCADE for all sub-records so that deleting an employee
-- or job opening automatically removes the associated detail rows, preventing
-- orphaned data.

-- ─────────────────────────────────────────────────────────────────
-- 1. FOREIGN KEY CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────

-- attendance.hrms_attendance → employee.hrms_employees
ALTER TABLE attendance.hrms_attendance
  DROP CONSTRAINT IF EXISTS fk_attendance_employee;
ALTER TABLE attendance.hrms_attendance
  ADD CONSTRAINT fk_attendance_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- leave.hrms_leave_apps → employee.hrms_employees
ALTER TABLE leave.hrms_leave_apps
  DROP CONSTRAINT IF EXISTS fk_leave_apps_employee;
ALTER TABLE leave.hrms_leave_apps
  ADD CONSTRAINT fk_leave_apps_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- leave.hrms_leave_allocs → employee.hrms_employees
ALTER TABLE leave.hrms_leave_allocs
  DROP CONSTRAINT IF EXISTS fk_leave_allocs_employee;
ALTER TABLE leave.hrms_leave_allocs
  ADD CONSTRAINT fk_leave_allocs_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- recruitment.hrms_applications → recruitment.hrms_job_openings
ALTER TABLE recruitment.hrms_applications
  DROP CONSTRAINT IF EXISTS fk_applications_job_opening;
ALTER TABLE recruitment.hrms_applications
  ADD CONSTRAINT fk_applications_job_opening
  FOREIGN KEY (job_opening_id)
  REFERENCES recruitment.hrms_job_openings(id)
  ON DELETE CASCADE;

-- training.hrms_nominations → employee.hrms_employees
ALTER TABLE training.hrms_nominations
  DROP CONSTRAINT IF EXISTS fk_nominations_employee;
ALTER TABLE training.hrms_nominations
  ADD CONSTRAINT fk_nominations_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- lifecycle.hrms_transfers → employee.hrms_employees
ALTER TABLE lifecycle.hrms_transfers
  DROP CONSTRAINT IF EXISTS fk_transfers_employee;
ALTER TABLE lifecycle.hrms_transfers
  ADD CONSTRAINT fk_transfers_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- lifecycle.hrms_promotions → employee.hrms_employees
ALTER TABLE lifecycle.hrms_promotions
  DROP CONSTRAINT IF EXISTS fk_promotions_employee;
ALTER TABLE lifecycle.hrms_promotions
  ADD CONSTRAINT fk_promotions_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- lifecycle.hrms_separations → employee.hrms_employees
ALTER TABLE lifecycle.hrms_separations
  DROP CONSTRAINT IF EXISTS fk_separations_employee;
ALTER TABLE lifecycle.hrms_separations
  ADD CONSTRAINT fk_separations_employee
  FOREIGN KEY (employee_id)
  REFERENCES employee.hrms_employees(id)
  ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- 2. CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────

-- lifecycle.hrms_transfers: status domain
ALTER TABLE lifecycle.hrms_transfers
  DROP CONSTRAINT IF EXISTS hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_transfers
  ADD CONSTRAINT hrms_transfers_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled'));

-- lifecycle.hrms_promotions: status domain
ALTER TABLE lifecycle.hrms_promotions
  DROP CONSTRAINT IF EXISTS hrms_promotions_status_check;
ALTER TABLE lifecycle.hrms_promotions
  ADD CONSTRAINT hrms_promotions_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled'));

-- lifecycle.hrms_separations: status domain
ALTER TABLE lifecycle.hrms_separations
  DROP CONSTRAINT IF EXISTS hrms_separations_status_check;
ALTER TABLE lifecycle.hrms_separations
  ADD CONSTRAINT hrms_separations_status_check
  CHECK (status IN ('initiated','approved','completed','cancelled'));

-- ─────────────────────────────────────────────────────────────────
-- 3. UNIQUE PARTIAL INDEX
-- ─────────────────────────────────────────────────────────────────
-- Prevent duplicate leave applications for the same employee/date/type,
-- but only for active (non-terminal) applications.  Rejected and cancelled
-- applications are excluded so the employee can re-apply after a rejection.
CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_apps_active
  ON leave.hrms_leave_apps (tenant_id, employee_id, from_date, leave_type_id)
  WHERE status NOT IN ('rejected', 'cancelled');
