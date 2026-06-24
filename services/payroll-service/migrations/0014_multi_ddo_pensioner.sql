-- 0014: Multi-DDO support + pensioner payroll. Additive + idempotent only.

-- ============================ Multi-DDO ============================
-- DDO (Drawing & Disbursing Officer) registry. A run is scoped to one DDO; the
-- run's slips, GL totals (via run.approved event) and bank-file are therefore
-- per-DDO automatically.
CREATE TABLE IF NOT EXISTS payroll.payroll_ddos (
  tenant_id   UUID        NOT NULL,
  ddo_code    VARCHAR(32) NOT NULL,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, ddo_code)
);

-- Department -> DDO mapping. An employee's departmentId (from HRMS payroll-input)
-- resolves to exactly one DDO via this table. A department maps to one DDO.
CREATE TABLE IF NOT EXISTS payroll.payroll_ddo_departments (
  tenant_id     UUID        NOT NULL,
  department_id UUID        NOT NULL,
  ddo_code      VARCHAR(32) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, department_id)
);
CREATE INDEX IF NOT EXISTS ix_payroll_ddo_departments_ddo
  ON payroll.payroll_ddo_departments (tenant_id, ddo_code);

-- Tag each run with the DDO it pays (NULL = legacy whole-tenant run).
ALTER TABLE payroll.payroll_runs
  ADD COLUMN IF NOT EXISTS ddo_code VARCHAR(32);

-- The per-month regular-run uniqueness must be per-DDO so two DDOs each get one
-- regular run in the same month. COALESCE keeps the old whole-tenant run unique
-- under a sentinel bucket. Replace the prior tenant+month regular guard.
DROP INDEX IF EXISTS payroll.ux_payroll_runs_tenant_month_regular;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_tenant_month_ddo_regular
  ON payroll.payroll_runs (tenant_id, month, COALESCE(ddo_code, '__ALL__'))
  WHERE status <> 'failed' AND run_type = 'regular';

-- ============================ Pensioner ============================
-- Allow the new pensioner run type alongside regular/supplementary/arrears.
ALTER TABLE payroll.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_run_type_check;
ALTER TABLE payroll.payroll_runs
  ADD CONSTRAINT payroll_runs_run_type_check
  CHECK (run_type IN ('regular','supplementary','arrears','pensioner'));

-- Pensioner master: monthly pension computation inputs. Money is PAISE bigint.
CREATE TABLE IF NOT EXISTS payroll.payroll_pensioners (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL,
  ppo_no                  TEXT        NOT NULL,            -- Pension Payment Order no
  full_name               TEXT        NOT NULL,
  date_of_birth           DATE        NOT NULL,            -- drives additional-pension age band
  basic_pension_minor     BIGINT      NOT NULL,            -- sanctioned basic pension (paise)
  commuted_pension_minor  BIGINT      NOT NULL DEFAULT 0,  -- portion commuted (deducted until restoration)
  commutation_date        DATE,                            -- restored 15y after this date
  medical_allowance_minor BIGINT      NOT NULL DEFAULT 0,  -- fixed monthly medical allowance (FMA)
  ddo_code                VARCHAR(32),                     -- pension-disbursing DDO (treasury)
  bank_account_no         TEXT,
  bank_ifsc               TEXT,
  pan                     TEXT,
  tax_regime              VARCHAR(8)  NOT NULL DEFAULT 'new',
  status                  VARCHAR(16) NOT NULL DEFAULT 'active', -- active|ceased
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID        NOT NULL,
  updated_by              UUID        NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payroll_pensioners_tenant
  ON payroll.payroll_pensioners (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_pensioners_ppo
  ON payroll.payroll_pensioners (tenant_id, ppo_no);
