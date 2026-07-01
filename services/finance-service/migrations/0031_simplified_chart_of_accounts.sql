-- Migration: Simplified Chart of Accounts for MSME / Small Office tenants
-- These accounts provide a FLAT (non-hierarchical) structure that maps to
-- standard double-entry under the hood but exposes simple Income/Expense/Asset/Liability
-- categories to the end user.

CREATE SCHEMA IF NOT EXISTS simplified;

-- Simplified accounts table (flat chart for MSME tenants)
CREATE TABLE simplified.accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  code        VARCHAR(8) NOT NULL,
  name        TEXT NOT NULL,
  category    VARCHAR(24) NOT NULL CHECK (category IN ('income', 'expense', 'asset', 'liability')),
  parent_code VARCHAR(8),
  is_group    BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

-- Simplified transactions (the user-friendly view of what happened)
CREATE TABLE simplified.transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  type            VARCHAR(32) NOT NULL CHECK (type IN (
    'sales_invoice', 'payment_received', 'purchase', 'payment_made',
    'salary_paid', 'expense_recorded'
  )),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  gst_minor       BIGINT NOT NULL DEFAULT 0,
  total_minor     BIGINT NOT NULL,
  account_code    VARCHAR(8) NOT NULL,
  counter_party   TEXT,
  description     TEXT,
  invoice_no      TEXT,
  journal_id      UUID,       -- links back to the GL journal auto-generated
  posting_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1
);

-- Indexes for tenant-scoped queries
CREATE INDEX idx_simplified_accounts_tenant ON simplified.accounts (tenant_id);
CREATE INDEX idx_simplified_txn_tenant_date ON simplified.transactions (tenant_id, posting_date DESC);
CREATE INDEX idx_simplified_txn_tenant_type ON simplified.transactions (tenant_id, type);
CREATE INDEX idx_simplified_txn_journal     ON simplified.transactions (journal_id) WHERE journal_id IS NOT NULL;

-- RLS policies (tenant isolation)
ALTER TABLE simplified.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE simplified.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY simplified_accounts_tenant_isolation ON simplified.accounts
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY simplified_transactions_tenant_isolation ON simplified.transactions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
