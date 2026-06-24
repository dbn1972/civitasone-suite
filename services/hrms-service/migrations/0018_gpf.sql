-- 0018_gpf.sql
-- GPF (General Provident Fund) account + advances/withdrawals ledger.
-- Additive + idempotent only. Money in paise (bigint).

CREATE SCHEMA IF NOT EXISTS gpf;

CREATE TABLE IF NOT EXISTS gpf.hrms_gpf_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  employee_id        uuid NOT NULL,
  gpf_number         varchar(32) NOT NULL,
  opening_balance_minor bigint NOT NULL DEFAULT 0,
  monthly_subscription_minor bigint NOT NULL DEFAULT 0,
  interest_rate_pct  numeric(5,2) NOT NULL DEFAULT 7.10,
  status             varchar(16) NOT NULL DEFAULT 'active',
  currency           char(3) NOT NULL DEFAULT 'INR',
  opened_at          date NOT NULL DEFAULT CURRENT_DATE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_gpf_accounts_status_check CHECK (status IN ('active','closed')),
  CONSTRAINT hrms_gpf_accounts_uq UNIQUE (tenant_id, employee_id)
);

-- ledger: subscription (credit), advance (debit, recoverable), withdrawal
-- (debit, non-recoverable), refund (credit), interest (credit).
CREATE TABLE IF NOT EXISTS gpf.hrms_gpf_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  account_id      uuid NOT NULL,
  employee_id     uuid NOT NULL,
  entry_type      varchar(16) NOT NULL,
  amount_minor    bigint NOT NULL,
  -- signed delta applied to the running balance (+credit / -debit)
  delta_minor     bigint NOT NULL,
  balance_minor   bigint NOT NULL,
  effective_date  date NOT NULL DEFAULT CURRENT_DATE,
  narrative       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  CONSTRAINT hrms_gpf_ledger_type_check
    CHECK (entry_type IN ('subscription','advance','withdrawal','refund','interest','opening')),
  CONSTRAINT hrms_gpf_ledger_amt_check CHECK (amount_minor >= 0)
);
CREATE INDEX IF NOT EXISTS hrms_gpf_ledger_acct_idx
  ON gpf.hrms_gpf_ledger (tenant_id, account_id, created_at);
