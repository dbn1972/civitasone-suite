-- 0011: P0 closure — disburse recorded earnings, revision-driven retro arrears,
-- supplementary/off-cycle run type + protected-net floor. Additive + idempotent.

-- P1: reimbursements need a consumed-run marker (arrears.run_id and
-- bonus.paid_in_run_id already exist). Pay each reimbursement exactly once.
ALTER TABLE payroll.payroll_reimbursements
  ADD COLUMN IF NOT EXISTS paid_in_run_id UUID;

-- P2: tag arrears with their origin so revision-generated retro arrears can be
-- deduped on re-run (manual arrears keep the default).
ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual';

-- One retro-arrear per (employee, component, month) from a revision, so
-- re-inserting the same back-dated revision (or re-running) cannot double-pay.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_arrears_revision_period
  ON payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period)
  WHERE source = 'revision';

-- P3: classify runs. Only ONE regular run per tenant+month; supplementary and
-- arrears runs may run alongside it.
ALTER TABLE payroll.payroll_runs
  ADD COLUMN IF NOT EXISTS run_type VARCHAR(16) NOT NULL DEFAULT 'regular';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_run_type_check'
  ) THEN
    ALTER TABLE payroll.payroll_runs
      ADD CONSTRAINT payroll_runs_run_type_check
      CHECK (run_type IN ('regular','supplementary','arrears'));
  END IF;
END $$;

-- Replace the blanket per-month uniqueness with a regular-only guard.
DROP INDEX IF EXISTS payroll.ux_payroll_runs_tenant_month_active;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_tenant_month_regular
  ON payroll.payroll_runs (tenant_id, month)
  WHERE status <> 'failed' AND run_type = 'regular';

-- P3: configurable protected-net floor (paise). Recovery deductions
-- (LOP / loan EMI / arrears recovery) must not push net below this.
CREATE TABLE IF NOT EXISTS payroll.payroll_settings (
  tenant_id UUID PRIMARY KEY,
  protected_net_floor_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
