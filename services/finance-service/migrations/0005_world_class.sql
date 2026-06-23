CREATE TABLE IF NOT EXISTS gl.finance_period_close (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_year CHAR(7) NOT NULL,
  period CHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_close','hard_close')),
  closed_by UUID, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL
);
CREATE TABLE IF NOT EXISTS gl.finance_bank_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  bank_account_id UUID NOT NULL,
  statement_date DATE NOT NULL,
  statement_balance_minor BIGINT NOT NULL DEFAULT 0,
  book_balance_minor BIGINT NOT NULL DEFAULT 0,
  difference_minor BIGINT NOT NULL DEFAULT 0,
  items_matched INT NOT NULL DEFAULT 0,
  items_unmatched INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL
);
