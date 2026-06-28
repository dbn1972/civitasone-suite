-- finance-service: Financial Year master + Opening Balances.
-- Additive, idempotent, forward-only.

-- Financial Year master — one active FY per tenant at a time.
CREATE TABLE IF NOT EXISTS gl.finance_fiscal_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(9) NOT NULL,      -- e.g. '2026-27'
  label       varchar(64) NOT NULL,     -- e.g. 'FY 2026-27'
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      varchar(12) NOT NULL DEFAULT 'active',  -- active|closed|draft
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

-- Opening Balances — per account head, per FY. Entered once at year start.
CREATE TABLE IF NOT EXISTS gl.finance_opening_balances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  fy_code     varchar(9) NOT NULL,
  account_code varchar(20) NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  narration   text,
  entered_at  timestamptz NOT NULL DEFAULT now(),
  entered_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, fy_code, account_code)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_years_tenant ON gl.finance_fiscal_years(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_opening_balances_tenant_fy ON gl.finance_opening_balances(tenant_id, fy_code);
