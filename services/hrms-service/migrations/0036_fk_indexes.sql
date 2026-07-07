-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: hrms-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- employee.hrms_departments.parent_id (self-referencing FK for hierarchy)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_parent_id
  ON employee.hrms_departments (parent_id) WHERE parent_id IS NOT NULL;

-- employee.hrms_employees.designation_id → employee.hrms_designations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_designation_id
  ON employee.hrms_employees (designation_id);

-- employee.hrms_employees.pay_structure_id (FK to payroll structure)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_pay_structure_id
  ON employee.hrms_employees (pay_structure_id) WHERE pay_structure_id IS NOT NULL;

-- employee.hrms_employee_docs.employee_id → employee.hrms_employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employee_docs_employee_id
  ON employee.hrms_employee_docs (employee_id);

-- recruitment.hrms_job_openings.department_id → employee.hrms_departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_openings_department_id
  ON recruitment.hrms_job_openings (department_id);

-- recruitment.hrms_job_openings.designation_id → employee.hrms_designations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_openings_designation_id
  ON recruitment.hrms_job_openings (designation_id) WHERE designation_id IS NOT NULL;

-- recruitment.hrms_applications.job_opening_id (already covered by composite idx_hrms_apps_opening — skip standalone)

-- recruitment.hrms_offers.application_id → recruitment.hrms_applications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_offers_application_id
  ON recruitment.hrms_offers (application_id);

-- attendance.hrms_shift_assignments.employee_id → employee.hrms_employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_assignments_employee_id
  ON attendance.hrms_shift_assignments (employee_id);

-- attendance.hrms_shift_assignments.shift_id → attendance.hrms_shifts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_assignments_shift_id
  ON attendance.hrms_shift_assignments (shift_id);

-- attendance.hrms_attendance.shift_id → attendance.hrms_shifts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_shift_id
  ON attendance.hrms_attendance (shift_id) WHERE shift_id IS NOT NULL;

-- leave.hrms_leave_apps.leave_type_id → leave.hrms_leave_types
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_apps_leave_type_id
  ON leave.hrms_leave_apps (leave_type_id);

-- leave.hrms_leave_apps.alloc_id → leave.hrms_leave_allocs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_apps_alloc_id
  ON leave.hrms_leave_apps (alloc_id);

-- training.hrms_nominations.employee_id → employee.hrms_employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nominations_employee_id
  ON training.hrms_nominations (employee_id);

-- lifecycle.hrms_transfers.employee_id → employee.hrms_employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_employee_id
  ON lifecycle.hrms_transfers (employee_id);

-- lifecycle.hrms_transfers.from_dept_id → employee.hrms_departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_from_dept_id
  ON lifecycle.hrms_transfers (from_dept_id);

-- lifecycle.hrms_transfers.to_dept_id → employee.hrms_departments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_to_dept_id
  ON lifecycle.hrms_transfers (to_dept_id);

-- lifecycle.hrms_promotions.employee_id → employee.hrms_employees
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_promotions_employee_id
  ON lifecycle.hrms_promotions (employee_id);

-- lifecycle.hrms_promotions.from_desig_id → employee.hrms_designations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_promotions_from_desig_id
  ON lifecycle.hrms_promotions (from_desig_id);

-- lifecycle.hrms_promotions.to_desig_id → employee.hrms_designations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_promotions_to_desig_id
  ON lifecycle.hrms_promotions (to_desig_id);

-- lifecycle.hrms_separations.employee_id (covered by idx_hrms_sep_emp — skip standalone)
