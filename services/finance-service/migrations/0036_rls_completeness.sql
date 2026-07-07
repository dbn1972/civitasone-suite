-- RLS completeness: cover tables added after 0035_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for all
--          budget and gl schema tables missing RLS enforcement.
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- budget.finance_budget_allocation
ALTER TABLE budget.finance_budget_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budget_allocation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budget_allocation;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_allocation;
CREATE POLICY tenant_isolation_policy ON budget.finance_budget_allocation
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_commitments
ALTER TABLE budget.finance_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_commitments;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_commitments;
CREATE POLICY tenant_isolation_policy ON budget.finance_commitments
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_ap_ledger
ALTER TABLE gl.finance_ap_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ap_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_ap_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ap_ledger;
CREATE POLICY tenant_isolation_policy ON gl.finance_ap_ledger
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_ar_ledger
ALTER TABLE gl.finance_ar_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ar_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_ar_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ar_ledger;
CREATE POLICY tenant_isolation_policy ON gl.finance_ar_ledger
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_cash_book
ALTER TABLE gl.finance_cash_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_cash_book FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_cash_book;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_cash_book;
CREATE POLICY tenant_isolation_policy ON gl.finance_cash_book
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_exchange_rates
ALTER TABLE gl.finance_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_exchange_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_exchange_rates;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_exchange_rates;
CREATE POLICY tenant_isolation_policy ON gl.finance_exchange_rates
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_gst_ledger
ALTER TABLE gl.finance_gst_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_gst_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_gst_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_gst_ledger;
CREATE POLICY tenant_isolation_policy ON gl.finance_gst_ledger
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_vendor_tds
ALTER TABLE gl.finance_vendor_tds ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_vendor_tds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_vendor_tds;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_vendor_tds;
CREATE POLICY tenant_isolation_policy ON gl.finance_vendor_tds
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_voucher_counter
ALTER TABLE gl.finance_voucher_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_counter FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_voucher_counter;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_voucher_counter;
CREATE POLICY tenant_isolation_policy ON gl.finance_voucher_counter
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_voucher_types
ALTER TABLE gl.finance_voucher_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_voucher_types;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_voucher_types;
CREATE POLICY tenant_isolation_policy ON gl.finance_voucher_types
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- ── Upgrade USING-only policies to USING + WITH CHECK ─────────────

-- budget.finance_reappropriation_log
ALTER TABLE budget.finance_reappropriation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_reappropriation_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_reappropriation_log;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_reappropriation_log;
CREATE POLICY tenant_isolation_policy ON budget.finance_reappropriation_log
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.head_utilisation
ALTER TABLE budget.head_utilisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.head_utilisation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.head_utilisation;
DROP POLICY IF EXISTS tenant_isolation ON budget.head_utilisation;
CREATE POLICY tenant_isolation_policy ON budget.head_utilisation
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_bank_reconciliation
ALTER TABLE gl.finance_bank_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_bank_reconciliation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_bank_reconciliation;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_bank_reconciliation;
CREATE POLICY tenant_isolation_policy ON gl.finance_bank_reconciliation
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_fiscal_years
ALTER TABLE gl.finance_fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_fiscal_years FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_fiscal_years;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_fiscal_years;
CREATE POLICY tenant_isolation_policy ON gl.finance_fiscal_years
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_opening_balances
ALTER TABLE gl.finance_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_opening_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_opening_balances;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_opening_balances;
CREATE POLICY tenant_isolation_policy ON gl.finance_opening_balances
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_recurring_entries
ALTER TABLE gl.finance_recurring_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_recurring_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_recurring_entries;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_recurring_entries;
CREATE POLICY tenant_isolation_policy ON gl.finance_recurring_entries
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());
