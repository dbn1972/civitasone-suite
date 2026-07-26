-- 0063_nps_cpf.sql
-- SVC-018 -> 100: NPS individual PRAN account + CPF contributory provident fund.
-- Additive + idempotent only. Money in paise (bigint). Employer + employee split
-- running balances carried on every ledger row (like GPF, plus an employer leg).

-- ── NPS: individual PRAN account + contribution ledger ───────────────────────
CREATE SCHEMA IF NOT EXISTS nps;

CREATE TABLE IF NOT EXISTS nps.hrms_nps_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  employee_id               uuid NOT NULL,
  pran                      varchar(20) NOT NULL,            -- Permanent Retirement Account Number
  tier                      varchar(2) NOT NULL DEFAULT 'I',
  opening_emp_minor         bigint NOT NULL DEFAULT 0,
  opening_er_minor          bigint NOT NULL DEFAULT 0,
  emp_contrib_pct           numeric(5,2) NOT NULL DEFAULT 10.00,
  er_contrib_pct            numeric(5,2) NOT NULL DEFAULT 14.00,
  status                    varchar(16) NOT NULL DEFAULT 'active',
  currency                  char(3) NOT NULL DEFAULT 'INR',
  opened_at                 date NOT NULL DEFAULT CURRENT_DATE,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_nps_accounts_tier_check   CHECK (tier IN ('I','II')),
  CONSTRAINT hrms_nps_accounts_status_check CHECK (status IN ('active','closed')),
  CONSTRAINT hrms_nps_accounts_uq  UNIQUE (tenant_id, employee_id),
  CONSTRAINT hrms_nps_accounts_pran_uq UNIQUE (tenant_id, pran)
);

-- contribution ledger: opening | contribution (emp+er credit) | withdrawal (debit) | return (credit)
CREATE TABLE IF NOT EXISTS nps.hrms_nps_contributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  account_id        uuid NOT NULL,
  employee_id       uuid NOT NULL,
  entry_type        varchar(16) NOT NULL,
  period            char(7),                                  -- YYYY-MM (contribution rows)
  emp_amount_minor  bigint NOT NULL DEFAULT 0,
  er_amount_minor   bigint NOT NULL DEFAULT 0,
  delta_minor       bigint NOT NULL,                          -- signed total applied (+/-)
  emp_balance_minor bigint NOT NULL,
  er_balance_minor  bigint NOT NULL,
  balance_minor     bigint NOT NULL,                          -- running total (emp+er)
  effective_date    date NOT NULL DEFAULT CURRENT_DATE,
  narrative         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  CONSTRAINT hrms_nps_contrib_type_check
    CHECK (entry_type IN ('opening','contribution','withdrawal','return')),
  CONSTRAINT hrms_nps_contrib_emp_check CHECK (emp_amount_minor >= 0),
  CONSTRAINT hrms_nps_contrib_er_check  CHECK (er_amount_minor  >= 0)
);
CREATE INDEX IF NOT EXISTS hrms_nps_contrib_acct_idx
  ON nps.hrms_nps_contributions (tenant_id, account_id, created_at);
-- idempotent monthly posting: one contribution row per account per period
CREATE UNIQUE INDEX IF NOT EXISTS hrms_nps_contrib_period_uq
  ON nps.hrms_nps_contributions (tenant_id, account_id, period)
  WHERE entry_type = 'contribution';

-- ── CPF: contributory provident fund account + ledger ────────────────────────
CREATE SCHEMA IF NOT EXISTS cpf;

CREATE TABLE IF NOT EXISTS cpf.hrms_cpf_accounts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL,
  employee_id                uuid NOT NULL,
  cpf_number                 varchar(32) NOT NULL,
  opening_emp_minor          bigint NOT NULL DEFAULT 0,
  opening_er_minor           bigint NOT NULL DEFAULT 0,
  monthly_subscription_minor bigint NOT NULL DEFAULT 0,
  interest_rate_pct          numeric(5,2) NOT NULL DEFAULT 7.10,
  status                     varchar(16) NOT NULL DEFAULT 'active',
  currency                   char(3) NOT NULL DEFAULT 'INR',
  opened_at                  date NOT NULL DEFAULT CURRENT_DATE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL,
  updated_by                 uuid NOT NULL,
  version                    integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_cpf_accounts_status_check CHECK (status IN ('active','closed')),
  CONSTRAINT hrms_cpf_accounts_uq UNIQUE (tenant_id, employee_id)
);

CREATE TABLE IF NOT EXISTS cpf.hrms_cpf_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  account_id        uuid NOT NULL,
  employee_id       uuid NOT NULL,
  entry_type        varchar(16) NOT NULL,
  period            char(7),
  emp_amount_minor  bigint NOT NULL DEFAULT 0,
  er_amount_minor   bigint NOT NULL DEFAULT 0,
  delta_minor       bigint NOT NULL,
  emp_balance_minor bigint NOT NULL,
  er_balance_minor  bigint NOT NULL,
  balance_minor     bigint NOT NULL,
  effective_date    date NOT NULL DEFAULT CURRENT_DATE,
  narrative         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  CONSTRAINT hrms_cpf_ledger_type_check
    CHECK (entry_type IN ('opening','subscription','advance','withdrawal','refund','interest')),
  CONSTRAINT hrms_cpf_ledger_emp_check CHECK (emp_amount_minor >= 0),
  CONSTRAINT hrms_cpf_ledger_er_check  CHECK (er_amount_minor  >= 0)
);
CREATE INDEX IF NOT EXISTS hrms_cpf_ledger_acct_idx
  ON cpf.hrms_cpf_ledger (tenant_id, account_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS hrms_cpf_ledger_period_uq
  ON cpf.hrms_cpf_ledger (tenant_id, account_id, period)
  WHERE entry_type = 'subscription';

-- ── pension_scheme: allow CPF alongside GPF/NPS/EPF ──────────────────────────
ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS chk_hrms_employees_pension_scheme;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_pension_scheme
  CHECK (pension_scheme IN ('GPF','NPS','EPF','CPF'));

-- ── RLS: FORCE tenant isolation on all four new tables ───────────────────────
ALTER TABLE nps.hrms_nps_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps.hrms_nps_accounts       FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON nps.hrms_nps_accounts;
CREATE POLICY tenant_isolation_policy ON nps.hrms_nps_accounts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE nps.hrms_nps_contributions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps.hrms_nps_contributions  FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON nps.hrms_nps_contributions;
CREATE POLICY tenant_isolation_policy ON nps.hrms_nps_contributions
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE cpf.hrms_cpf_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpf.hrms_cpf_accounts       FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON cpf.hrms_cpf_accounts;
CREATE POLICY tenant_isolation_policy ON cpf.hrms_cpf_accounts
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

ALTER TABLE cpf.hrms_cpf_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpf.hrms_cpf_ledger         FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON cpf.hrms_cpf_ledger;
CREATE POLICY tenant_isolation_policy ON cpf.hrms_cpf_ledger
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
