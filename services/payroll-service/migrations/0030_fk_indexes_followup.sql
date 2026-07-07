-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: payroll-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- payroll.fnf_settlements.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fnf_settlements_employee_id
  ON payroll.fnf_settlements (employee_id);

-- payroll.fnf_settlements.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fnf_settlements_run_id
  ON payroll.fnf_settlements (run_id);

-- payroll.ltc_exemptions.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ltc_exemptions_employee_id
  ON payroll.ltc_exemptions (employee_id);

-- payroll.ltc_exemptions.claim_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ltc_exemptions_claim_id
  ON payroll.ltc_exemptions (claim_id);

-- payroll.payroll_lop_ledger.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_lop_ledger_employee_id
  ON payroll.payroll_lop_ledger (employee_id);

-- loans.payroll_loans.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_loans_employee_id
  ON loans.payroll_loans (employee_id);

-- loans.payroll_loan_repayments.loan_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_loan_repayments_loan_id
  ON loans.payroll_loan_repayments (loan_id);

-- payroll.nach_return_records.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nach_return_records_run_id
  ON payroll.nach_return_records (run_id);

-- payroll.nach_return_records.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nach_return_records_slip_id
  ON payroll.nach_return_records (slip_id);

-- payroll.payroll_runs.legal_entity_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_runs_legal_entity_id
  ON payroll.payroll_runs (legal_entity_id);

-- payroll.payroll_slips.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_slips_run_id
  ON payroll.payroll_slips (run_id);

-- payroll.payroll_slips.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_slips_employee_id
  ON payroll.payroll_slips (employee_id);

-- payroll.payroll_ddo_departments.department_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_ddo_departments_department_id
  ON payroll.payroll_ddo_departments (department_id);

-- statutory.payroll_pf.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_pf_slip_id
  ON statutory.payroll_pf (slip_id);

-- statutory.payroll_pf.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_pf_run_id
  ON statutory.payroll_pf (run_id);

-- statutory.payroll_esi.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_esi_slip_id
  ON statutory.payroll_esi (slip_id);

-- statutory.payroll_tds.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_tds_slip_id
  ON statutory.payroll_tds (slip_id);

-- statutory.payroll_tds.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_tds_run_id
  ON statutory.payroll_tds (run_id);

-- statutory.payroll_gpf.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gpf_slip_id
  ON statutory.payroll_gpf (slip_id);

-- statutory.payroll_gpf.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gpf_employee_id
  ON statutory.payroll_gpf (employee_id);

-- statutory.payroll_gpf.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gpf_run_id
  ON statutory.payroll_gpf (run_id);

-- statutory.payroll_nps.slip_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_nps_slip_id
  ON statutory.payroll_nps (slip_id);

-- statutory.payroll_nps.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_nps_employee_id
  ON statutory.payroll_nps (employee_id);

-- statutory.payroll_nps.run_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_nps_run_id
  ON statutory.payroll_nps (run_id);

-- payroll.payroll_tax_declarations.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_tax_declarations_employee_id
  ON payroll.payroll_tax_declarations (employee_id);

-- payroll.perquisite_components.employee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perquisite_components_employee_id
  ON payroll.perquisite_components (employee_id);
