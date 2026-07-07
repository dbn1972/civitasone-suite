-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: payroll-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- payroll.payroll_components.structure_id → payroll.payroll_structures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_components_structure_id
  ON payroll.payroll_components (structure_id);

-- payroll.payroll_runs.structure_id → payroll.payroll_structures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_structure_id
  ON payroll.payroll_runs (structure_id);

-- payroll.payroll_runs.department_id (FK to department)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_department_id
  ON payroll.payroll_runs (department_id) WHERE department_id IS NOT NULL;

-- statutory.payroll_pf.employee_id (FK to employee)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_pf_employee_id
  ON statutory.payroll_pf (employee_id);

-- statutory.payroll_esi.employee_id (FK to employee)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_esi_employee_id
  ON statutory.payroll_esi (employee_id);

-- statutory.payroll_esi.run_id → payroll.payroll_runs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_esi_run_id
  ON statutory.payroll_esi (run_id);

-- statutory.payroll_tds.employee_id (FK to employee)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_tds_employee_id
  ON statutory.payroll_tds (employee_id);

-- statutory.payroll_gratuity.employee_id (FK to employee)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gratuity_employee_id
  ON statutory.payroll_gratuity (employee_id);

-- loans.payroll_loan_repayments.run_id → payroll.payroll_runs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_repayments_run_id
  ON loans.payroll_loan_repayments (run_id) WHERE run_id IS NOT NULL;
