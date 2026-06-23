-- Migration 0009: World-class Finance Module Parity (SAP/Oracle/Tally)
-- Cash Book / Day Book (GFR Rule 9)
CREATE TABLE IF NOT EXISTS gl.finance_cash_book (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entry_date DATE NOT NULL,
  voucher_type VARCHAR(20) NOT NULL CHECK (voucher_type IN ('receipt','payment','contra','journal','debit_note','credit_note')),
  voucher_no VARCHAR(64) NOT NULL,
  particulars TEXT NOT NULL,
  receipt_minor BIGINT NOT NULL DEFAULT 0,
  payment_minor BIGINT NOT NULL DEFAULT 0,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  bank_or_cash VARCHAR(10) NOT NULL DEFAULT 'cash' CHECK (bank_or_cash IN ('cash','bank')),
  reference VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cashbook_tenant_date ON gl.finance_cash_book(tenant_id, entry_date);

-- Voucher Types
CREATE TABLE IF NOT EXISTS gl.finance_voucher_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(64) NOT NULL,
  nature VARCHAR(20) NOT NULL CHECK (nature IN ('receipt','payment','contra','journal','debit_note','credit_note','transfer')),
  auto_number_prefix VARCHAR(10),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- Vendor TDS (Section 194C/194J/194H etc)
CREATE TABLE IF NOT EXISTS gl.finance_vendor_tds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  vendor_name VARCHAR(256),
  pan VARCHAR(10),
  bill_id UUID,
  payment_id UUID,
  section VARCHAR(10) NOT NULL DEFAULT '194C',
  gross_amount_minor BIGINT NOT NULL,
  tds_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 2.00,
  tds_amount_minor BIGINT NOT NULL,
  surcharge_minor BIGINT NOT NULL DEFAULT 0,
  cess_minor BIGINT NOT NULL DEFAULT 0,
  net_payment_minor BIGINT NOT NULL,
  deduction_date DATE NOT NULL,
  deposit_date DATE,
  challan_no VARCHAR(64),
  quarter VARCHAR(2) NOT NULL,
  fy VARCHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'deducted' CHECK (status IN ('deducted','deposited','filed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_tds_tenant ON gl.finance_vendor_tds(tenant_id, fy, quarter);

-- GST Ledger (Input/Output)
CREATE TABLE IF NOT EXISTS gl.finance_gst_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  invoice_id UUID,
  invoice_no VARCHAR(64),
  invoice_date DATE NOT NULL,
  party_gstin VARCHAR(15),
  party_name VARCHAR(256),
  gst_type VARCHAR(10) NOT NULL CHECK (gst_type IN ('CGST','SGST','IGST','CESS')),
  direction VARCHAR(6) NOT NULL CHECK (direction IN ('input','output')),
  taxable_minor BIGINT NOT NULL,
  tax_minor BIGINT NOT NULL,
  rate_pct NUMERIC(5,2) NOT NULL,
  hsn_code VARCHAR(8),
  period VARCHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_period ON gl.finance_gst_ledger(tenant_id, period, direction);

-- AP Sub-Ledger (Accounts Payable)
CREATE TABLE IF NOT EXISTS gl.finance_ap_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  vendor_name VARCHAR(256),
  bill_id UUID,
  bill_date DATE NOT NULL,
  due_date DATE,
  amount_minor BIGINT NOT NULL,
  paid_minor BIGINT NOT NULL DEFAULT 0,
  balance_minor BIGINT NOT NULL,
  aging_bucket VARCHAR(16) NOT NULL DEFAULT '0-30' CHECK (aging_bucket IN ('0-30','31-60','61-90','91-180','180+')),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AR Sub-Ledger (Accounts Receivable)
CREATE TABLE IF NOT EXISTS gl.finance_ar_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  debtor_id UUID,
  debtor_name VARCHAR(256),
  demand_id UUID,
  invoice_date DATE NOT NULL,
  due_date DATE,
  amount_minor BIGINT NOT NULL,
  received_minor BIGINT NOT NULL DEFAULT 0,
  balance_minor BIGINT NOT NULL,
  aging_bucket VARCHAR(16) NOT NULL DEFAULT '0-30',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recurring Entries (Standing Instructions)
CREATE TABLE IF NOT EXISTS gl.finance_recurring_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(256) NOT NULL,
  voucher_type VARCHAR(20) NOT NULL DEFAULT 'journal',
  frequency VARCHAR(16) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily','weekly','monthly','quarterly','yearly')),
  debit_account_id UUID NOT NULL,
  credit_account_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL,
  narration TEXT,
  next_run_date DATE NOT NULL,
  last_run_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- Commitment Register
CREATE TABLE IF NOT EXISTS budget.finance_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  budget_head_id UUID NOT NULL,
  reference_type VARCHAR(20) NOT NULL CHECK (reference_type IN ('po','contract','indent','sanction')),
  reference_id UUID NOT NULL,
  reference_no VARCHAR(64),
  committed_minor BIGINT NOT NULL,
  released_minor BIGINT NOT NULL DEFAULT 0,
  balance_minor BIGINT NOT NULL,
  fy VARCHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','partially_released','fully_released','cancelled')),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commitments_head ON budget.finance_commitments(tenant_id, budget_head_id, fy);

-- Exchange Rates (Multi-Currency)
CREATE TABLE IF NOT EXISTS gl.finance_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL DEFAULT 'INR',
  rate NUMERIC(12,6) NOT NULL,
  effective_date DATE NOT NULL,
  source VARCHAR(32) DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, from_currency, to_currency, effective_date)
);

-- Seed voucher types
INSERT INTO gl.finance_voucher_types (tenant_id, code, name, nature, auto_number_prefix) VALUES
  ('00000000-0000-0000-0000-000000000001', 'RCV', 'Receipt Voucher', 'receipt', 'RCV/'),
  ('00000000-0000-0000-0000-000000000001', 'PMT', 'Payment Voucher', 'payment', 'PMT/'),
  ('00000000-0000-0000-0000-000000000001', 'CTR', 'Contra Voucher', 'contra', 'CTR/'),
  ('00000000-0000-0000-0000-000000000001', 'JV', 'Journal Voucher', 'journal', 'JV/'),
  ('00000000-0000-0000-0000-000000000001', 'DN', 'Debit Note', 'debit_note', 'DN/'),
  ('00000000-0000-0000-0000-000000000001', 'CN', 'Credit Note', 'credit_note', 'CN/'),
  ('00000000-0000-0000-0000-000000000001', 'TRF', 'Transfer Voucher', 'transfer', 'TRF/')
ON CONFLICT DO NOTHING;
