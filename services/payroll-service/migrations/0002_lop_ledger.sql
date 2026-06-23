-- payroll LOP ledger for cross-event leave/attendance deductions

CREATE TABLE IF NOT EXISTS payroll.payroll_lop_ledger (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  employee_id  uuid        NOT NULL,
  month        char(7)     NOT NULL,
  lop_days     integer     NOT NULL DEFAULT 0,
  source       varchar(32) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, month, source)
);

CREATE INDEX IF NOT EXISTS idx_payroll_lop_ledger_tenant_month
  ON payroll.payroll_lop_ledger (tenant_id, month);
