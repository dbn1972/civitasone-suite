-- Migration 0011: bank reconciliation, budget allocation/appropriation control,
-- period reopen audit. Additive + idempotent only.

-- ============================================================
-- 1. Bank statement import (header) + lines
-- ============================================================
CREATE TABLE IF NOT EXISTS treasury.finance_bank_statement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  statement_ref   text,
  period_from     date,
  period_to       date,
  opening_minor   bigint NOT NULL DEFAULT 0,
  closing_minor   bigint NOT NULL DEFAULT 0,
  line_count      integer NOT NULL DEFAULT 0,
  status          varchar(16) NOT NULL DEFAULT 'imported',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_tenant ON treasury.finance_bank_statement(tenant_id, bank_account_id);

CREATE TABLE IF NOT EXISTS treasury.finance_bank_statement_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  statement_id  uuid NOT NULL,
  line_date     date NOT NULL,
  amount_minor  bigint NOT NULL DEFAULT 0,         -- absolute value in paise
  direction     varchar(6) NOT NULL,               -- 'debit' (money out) | 'credit' (money in)
  narration     text,
  reference     text,                              -- UTR / cheque / instrument ref
  matched       boolean NOT NULL DEFAULT false,
  match_type    varchar(16),                       -- 'payment' | 'receipt'
  match_id      uuid,                              -- finance_payments.id or finance_challans.id
  matched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_bsl_direction CHECK (direction IN ('debit','credit'))
);
CREATE INDEX IF NOT EXISTS idx_bsl_statement ON treasury.finance_bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_bsl_tenant_matched ON treasury.finance_bank_statement_lines(tenant_id, matched);

-- Reconciliation markers on the in-books side (payments = money out, challans/receipts = money in)
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false;
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS reconciled_line_id uuid;
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE treasury.finance_challans
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false;
ALTER TABLE treasury.finance_challans
  ADD COLUMN IF NOT EXISTS reconciled_line_id uuid;
ALTER TABLE treasury.finance_challans
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

-- ============================================================
-- 2. Budget allocation / appropriation control (per HoA head + FY)
-- ============================================================
CREATE TABLE IF NOT EXISTS budget.finance_budget_allocation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  head_id         uuid NOT NULL,
  fy              char(7) NOT NULL,                -- YYYY-YY
  allocated_minor bigint NOT NULL DEFAULT 0,
  committed_minor bigint NOT NULL DEFAULT 0,       -- in-flight commitments (bills not yet paid)
  actual_minor    bigint NOT NULL DEFAULT 0,       -- realised expenditure (paid)
  enforce         boolean NOT NULL DEFAULT true,   -- configurable hard block
  currency        char(3) NOT NULL DEFAULT 'INR',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, head_id, fy)
);
CREATE INDEX IF NOT EXISTS idx_budget_alloc_tenant ON budget.finance_budget_allocation(tenant_id, fy);

-- Re-appropriation audit log (move allocation between heads)
CREATE TABLE IF NOT EXISTS budget.finance_reappropriation_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  fy            char(7) NOT NULL,
  from_head_id  uuid NOT NULL,
  to_head_id    uuid NOT NULL,
  amount_minor  bigint NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reappr_tenant ON budget.finance_reappropriation_log(tenant_id, fy);

-- ============================================================
-- 3. Period reopen audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS gl.finance_period_reopen_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  period        varchar(7) NOT NULL,
  from_status   varchar(12) NOT NULL,
  to_status     varchar(12) NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_period_reopen_tenant ON gl.finance_period_reopen_log(tenant_id, period);
