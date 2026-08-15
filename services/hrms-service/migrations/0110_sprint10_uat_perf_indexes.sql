-- Migration 0110: Sprint-10 UAT perf — query-column indexes for 3 UAT modules
-- Covers: HR/Employee, Leave/Attendance, Recruitment, Training
-- Already covered by 0036/0038: department_id, employee_id (leave/attendance/nominations),
--   job_opening_id, application_id, training_id, shift_id, designation_id.
-- This migration adds the remaining heavily-queried filter/sort columns that were missing.
-- Safety: CONCURRENTLY + IF NOT EXISTS → no table locks, idempotent.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- ── EMPLOYEE ──────────────────────────────────────────────────────────────────
-- Tenant-scoped employee list (every list query filters on tenant_id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_tenant_id
  ON employee.hrms_employees (tenant_id);

-- Status filter: active/probation/inactive employee lists.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_employees_tenant_status
  ON employee.hrms_employees (tenant_id, status);

-- Department tenant index (org-chart and transfer queries filter by tenant first).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_departments_tenant_id
  ON employee.hrms_departments (tenant_id);

-- Designation tenant index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_designations_tenant_id
  ON employee.hrms_designations (tenant_id);

-- ── LEAVE ─────────────────────────────────────────────────────────────────────
-- Tenant-scoped leave application list (approval inbox, HR dashboard).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_apps_tenant_id
  ON leave.hrms_leave_apps (tenant_id);

-- Status filter: pending/approved/rejected leave views.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_apps_tenant_status
  ON leave.hrms_leave_apps (tenant_id, status);

-- Date-range leave queries (calendar overlap, payroll cut-off).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_apps_from_date
  ON leave.hrms_leave_apps (from_date);

-- Leave type tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_types_tenant_id
  ON leave.hrms_leave_types (tenant_id);

-- Leave alloc tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_leave_allocs_tenant_id
  ON leave.hrms_leave_allocs (tenant_id);

-- ── ATTENDANCE ────────────────────────────────────────────────────────────────
-- Attendance date lookup (daily punching, monthly report, payroll lock check).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_date
  ON attendance.hrms_attendance (attendance_date);

-- Composite (tenant, date) for month-range report queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_tenant_date
  ON attendance.hrms_attendance (tenant_id, attendance_date);

-- Tenant scoping on regularisations.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_reg_tenant_id
  ON attendance.hrms_attendance_regularisations (tenant_id);

-- Status filter on regularisations (pending approval inbox).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_attendance_reg_status
  ON attendance.hrms_attendance_regularisations (tenant_id, status);

-- Shifts tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_shifts_tenant_id
  ON attendance.hrms_shifts (tenant_id);

-- Shift assignments tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_shift_assignments_tenant_id
  ON attendance.hrms_shift_assignments (tenant_id);

-- WFH requests tenant + status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_wfh_requests_tenant_status
  ON attendance.hrms_wfh_requests (tenant_id, status);

-- ── RECRUITMENT ───────────────────────────────────────────────────────────────
-- Job openings: tenant-scoped list (job board, HR job management).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_job_openings_tenant_id
  ON recruitment.hrms_job_openings (tenant_id);

-- Job openings: status filter (open/closed/draft job lists).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_job_openings_tenant_status
  ON recruitment.hrms_job_openings (tenant_id, status);

-- Applications: tenant-scoped list (application pipeline view).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_applications_tenant_id
  ON recruitment.hrms_applications (tenant_id);

-- Applications: status filter (active/shortlisted/rejected pipeline).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_applications_tenant_status
  ON recruitment.hrms_applications (tenant_id, status);

-- Offers tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_offers_tenant_id
  ON recruitment.hrms_offers (tenant_id);

-- Offers status filter (draft/released/accepted).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_offers_tenant_status
  ON recruitment.hrms_offers (tenant_id, status);

-- Interviews tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_interviews_tenant_id
  ON recruitment.hrms_interviews (tenant_id);

-- ── TRAINING ──────────────────────────────────────────────────────────────────
-- Training catalog: tenant-scoped list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_trainings_tenant_id
  ON training.hrms_trainings (tenant_id);

-- Training status filter (planned/ongoing/completed).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_trainings_tenant_status
  ON training.hrms_trainings (tenant_id, status);

-- Nominations tenant scoping.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_nominations_tenant_id
  ON training.hrms_nominations (tenant_id);
