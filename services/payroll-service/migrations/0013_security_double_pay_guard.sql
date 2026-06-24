-- 0013: SECURITY remediation (C1/C2 double-pay race, H1 overpayment recovery).
-- Additive + idempotent. No destructive changes.

-- C1/C2: support efficient FOR UPDATE locking + marker-IS-NULL consume guard on
-- the candidate (unconsumed) earning rows, so concurrent regular vs
-- supplementary runs serialise on the same rows and each is paid exactly once.
CREATE INDEX IF NOT EXISTS ix_payroll_arrears_unconsumed
  ON payroll.payroll_arrears (tenant_id, employee_id, from_period)
  WHERE run_id IS NULL AND status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS ix_payroll_bonus_unconsumed
  ON payroll.payroll_bonus (tenant_id, employee_id)
  WHERE paid_in_run_id IS NULL AND status = 'approved';

CREATE INDEX IF NOT EXISTS ix_payroll_reimbursements_unconsumed
  ON payroll.payroll_reimbursements (tenant_id, employee_id, period)
  WHERE paid_in_run_id IS NULL AND status = 'approved';

-- H2: support the non-finalised-run probe used by the 24Q reconciliation gate.
CREATE INDEX IF NOT EXISTS ix_payroll_runs_tenant_month_status
  ON payroll.payroll_runs (tenant_id, month, status);
