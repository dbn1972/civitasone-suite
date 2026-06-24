-- Iter2: one non-failed payroll run per tenant+month (belt-and-suspenders to the app check).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_tenant_month_active
  ON payroll.payroll_runs (tenant_id, month)
  WHERE status <> 'failed';
