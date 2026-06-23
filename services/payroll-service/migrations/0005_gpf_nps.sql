-- P3: GPF/NPS statutory deduction columns + ledger tables

ALTER TABLE payroll.payroll_slips
  ADD COLUMN IF NOT EXISTS gpf_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE payroll.payroll_slips
  ADD COLUMN IF NOT EXISTS nps_employee_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE payroll.payroll_slips
  ADD COLUMN IF NOT EXISTS nps_employer_minor bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS statutory.payroll_gpf (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  slip_id           uuid NOT NULL,
  employee_id       uuid NOT NULL,
  run_id            uuid NOT NULL,
  basic_minor       bigint NOT NULL DEFAULT 0,
  contrib_pct       numeric(5,2) NOT NULL DEFAULT 10,
  emp_contrib_minor bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'INR',
  period            char(7) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS statutory.payroll_nps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  slip_id           uuid NOT NULL,
  employee_id       uuid NOT NULL,
  run_id            uuid NOT NULL,
  basic_minor       bigint NOT NULL DEFAULT 0,
  emp_contrib_pct   numeric(5,2) NOT NULL DEFAULT 10,
  er_contrib_pct    numeric(5,2) NOT NULL DEFAULT 14,
  emp_contrib_minor bigint NOT NULL DEFAULT 0,
  er_contrib_minor  bigint NOT NULL DEFAULT 0,
  currency          char(3) NOT NULL DEFAULT 'INR',
  period            char(7) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_payroll_gpf_tenant ON statutory.payroll_gpf(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_nps_tenant ON statutory.payroll_nps(tenant_id);
