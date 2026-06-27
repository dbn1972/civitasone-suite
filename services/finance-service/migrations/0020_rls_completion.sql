-- Migration 0020: RLS completion — tenant isolation for all remaining finance tables.
-- 0019 covered budget (heads/budgets/demands/schemes/sanctions), gl (journals/ledger),
-- payments (bills/payments), and _outbox.messages. This migration covers everything else.
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY; ENABLE/FORCE are no-ops if already set.
-- Uses budget.current_tenant_id() (created in 0019).

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- payments schema — remaining tables
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE payments.finance_advances    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_uc          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pao         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_ddo         ENABLE ROW LEVEL SECURITY;

ALTER TABLE payments.finance_advances    FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_uc          FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms        FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms_config FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pao         FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_ddo         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON payments.finance_advances;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_uc;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pfms;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pfms_config;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pao;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_ddo;

CREATE POLICY tenant_isolation ON payments.finance_advances    USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_uc          USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_pfms        USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_pfms_config USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_pao         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON payments.finance_ddo         USING (tenant_id = budget.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════
-- treasury schema
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE treasury.finance_banks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_challans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_debt             ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_guarantees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_instruments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement   ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposit_events   ENABLE ROW LEVEL SECURITY;

ALTER TABLE treasury.finance_banks            FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_challans         FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposits         FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_debt             FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_guarantees       FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_instruments      FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement   FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposit_events   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_banks;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_challans;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_deposits;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_debt;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_guarantees;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_instruments;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_bank_statement;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_bank_statement_lines;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_deposit_events;

CREATE POLICY tenant_isolation ON treasury.finance_banks            USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_challans         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_deposits         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_debt             USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_guarantees       USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_instruments      USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_bank_statement   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_bank_statement_lines USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON treasury.finance_deposit_events   USING (tenant_id = budget.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════
-- audit schema
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE audit.finance_audit_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.finance_audit_paras FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit.finance_audit_paras;

CREATE POLICY tenant_isolation ON audit.finance_audit_paras USING (tenant_id = budget.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════
-- gl schema — remaining tables
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE gl.finance_cash_book         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_vendor_tds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_gst_ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ap_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ar_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_recurring_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_exchange_rates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_counter   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_close      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_bank_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_reopen_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE gl.finance_cash_book         FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_types     FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_vendor_tds        FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_gst_ledger        FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ap_ledger         FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ar_ledger         FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_recurring_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_exchange_rates    FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_voucher_counter   FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_close      FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_bank_reconciliation FORCE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_reopen_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON gl.finance_cash_book;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_voucher_types;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_vendor_tds;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_gst_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ap_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ar_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_recurring_entries;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_exchange_rates;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_voucher_counter;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_period_close;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_bank_reconciliation;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_period_reopen_log;

CREATE POLICY tenant_isolation ON gl.finance_cash_book         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_voucher_types     USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_vendor_tds        USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_gst_ledger        USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_ap_ledger         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_ar_ledger         USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_recurring_entries USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_exchange_rates    USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_voucher_counter   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_period_close      USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_bank_reconciliation USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON gl.finance_period_reopen_log USING (tenant_id = budget.current_tenant_id());

-- ══════════════════════════════════════════════════════════════════
-- budget schema — remaining tables
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE budget.finance_budget_allocation   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_reappropriation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_commitments         ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget.finance_budget_allocation   FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_reappropriation_log FORCE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_commitments         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budget_allocation;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_reappropriation_log;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_commitments;

CREATE POLICY tenant_isolation ON budget.finance_budget_allocation   USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_reappropriation_log USING (tenant_id = budget.current_tenant_id());
CREATE POLICY tenant_isolation ON budget.finance_commitments         USING (tenant_id = budget.current_tenant_id());

COMMIT;
