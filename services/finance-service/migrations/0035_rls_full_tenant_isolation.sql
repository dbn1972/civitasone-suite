-- RLS completion: full tenant isolation (USING + WITH CHECK) for finance-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION budget.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- audit.finance_audit_paras
ALTER TABLE audit.finance_audit_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.finance_audit_paras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON audit.finance_audit_paras;
DROP POLICY IF EXISTS tenant_isolation ON audit.finance_audit_paras;
CREATE POLICY tenant_isolation_policy ON audit.finance_audit_paras
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_budgets
ALTER TABLE budget.finance_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_budgets;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_budgets;
CREATE POLICY tenant_isolation_policy ON budget.finance_budgets
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_demands
ALTER TABLE budget.finance_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_demands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_demands;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_demands;
CREATE POLICY tenant_isolation_policy ON budget.finance_demands
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_heads
ALTER TABLE budget.finance_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_heads;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_heads;
CREATE POLICY tenant_isolation_policy ON budget.finance_heads
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_major_heads is deliberately skipped: it is a GLOBAL CGA
-- reference master with no tenant_id column (see 0043_schema_drift_fixups.sql
-- item (f), which had to walk back an earlier version of this exact block
-- force-enabling RLS here — that made every read default-deny since no
-- tenant_id-based policy can apply).

-- budget.finance_reappropriations
ALTER TABLE budget.finance_reappropriations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_reappropriations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_reappropriations;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_reappropriations;
CREATE POLICY tenant_isolation_policy ON budget.finance_reappropriations
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_sanctions
ALTER TABLE budget.finance_sanctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_sanctions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_sanctions;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_sanctions;
CREATE POLICY tenant_isolation_policy ON budget.finance_sanctions
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- budget.finance_schemes
ALTER TABLE budget.finance_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_schemes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON budget.finance_schemes;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_schemes;
CREATE POLICY tenant_isolation_policy ON budget.finance_schemes
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_journal_lines
ALTER TABLE gl.finance_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_journal_lines;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_journal_lines;
CREATE POLICY tenant_isolation_policy ON gl.finance_journal_lines
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_journals
ALTER TABLE gl.finance_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_journals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_journals;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_journals;
CREATE POLICY tenant_isolation_policy ON gl.finance_journals
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_ledger
ALTER TABLE gl.finance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_ledger;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_ledger;
CREATE POLICY tenant_isolation_policy ON gl.finance_ledger
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_period_close
ALTER TABLE gl.finance_period_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_close FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_period_close;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_period_close;
CREATE POLICY tenant_isolation_policy ON gl.finance_period_close
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- gl.finance_period_reopen_log
ALTER TABLE gl.finance_period_reopen_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_period_reopen_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.finance_period_reopen_log;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_period_reopen_log;
CREATE POLICY tenant_isolation_policy ON gl.finance_period_reopen_log
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- org.cost_centers
ALTER TABLE org.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.cost_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON org.cost_centers;
DROP POLICY IF EXISTS tenant_isolation ON org.cost_centers;
CREATE POLICY tenant_isolation_policy ON org.cost_centers
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- org.legal_entities
ALTER TABLE org.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.legal_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON org.legal_entities;
DROP POLICY IF EXISTS tenant_isolation ON org.legal_entities;
CREATE POLICY tenant_isolation_policy ON org.legal_entities
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- org.operating_units
ALTER TABLE org.operating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.operating_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON org.operating_units;
DROP POLICY IF EXISTS tenant_isolation ON org.operating_units;
CREATE POLICY tenant_isolation_policy ON org.operating_units
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- org.profit_centers
ALTER TABLE org.profit_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.profit_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON org.profit_centers;
DROP POLICY IF EXISTS tenant_isolation ON org.profit_centers;
CREATE POLICY tenant_isolation_policy ON org.profit_centers
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- org.purchasing_orgs
ALTER TABLE org.purchasing_orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.purchasing_orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON org.purchasing_orgs;
DROP POLICY IF EXISTS tenant_isolation ON org.purchasing_orgs;
CREATE POLICY tenant_isolation_policy ON org.purchasing_orgs
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_advances
ALTER TABLE payments.finance_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_advances;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_advances;
CREATE POLICY tenant_isolation_policy ON payments.finance_advances
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_bills
ALTER TABLE payments.finance_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_bills;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_bills;
CREATE POLICY tenant_isolation_policy ON payments.finance_bills
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_ddo
ALTER TABLE payments.finance_ddo ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_ddo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_ddo;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_ddo;
CREATE POLICY tenant_isolation_policy ON payments.finance_ddo
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_grn_match
ALTER TABLE payments.finance_grn_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_grn_match FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_grn_match;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_grn_match;
CREATE POLICY tenant_isolation_policy ON payments.finance_grn_match
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_pao
ALTER TABLE payments.finance_pao ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pao FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_pao;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pao;
CREATE POLICY tenant_isolation_policy ON payments.finance_pao
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_payments
ALTER TABLE payments.finance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_payments;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_payments;
CREATE POLICY tenant_isolation_policy ON payments.finance_payments
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_pfms
ALTER TABLE payments.finance_pfms ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_pfms;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pfms;
CREATE POLICY tenant_isolation_policy ON payments.finance_pfms
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_pfms_config
ALTER TABLE payments.finance_pfms_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_pfms_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_pfms_config;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_pfms_config;
CREATE POLICY tenant_isolation_policy ON payments.finance_pfms_config
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- payments.finance_uc
ALTER TABLE payments.finance_uc ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_uc FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_uc;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_uc;
CREATE POLICY tenant_isolation_policy ON payments.finance_uc
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- simplified.accounts
ALTER TABLE simplified.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE simplified.accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON simplified.accounts;
DROP POLICY IF EXISTS tenant_isolation ON simplified.accounts;
CREATE POLICY tenant_isolation_policy ON simplified.accounts
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- simplified.transactions
ALTER TABLE simplified.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE simplified.transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON simplified.transactions;
DROP POLICY IF EXISTS tenant_isolation ON simplified.transactions;
CREATE POLICY tenant_isolation_policy ON simplified.transactions
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_bank_statement
ALTER TABLE treasury.finance_bank_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_bank_statement;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_bank_statement;
CREATE POLICY tenant_isolation_policy ON treasury.finance_bank_statement
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_bank_statement_lines
ALTER TABLE treasury.finance_bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_bank_statement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_bank_statement_lines;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_bank_statement_lines;
CREATE POLICY tenant_isolation_policy ON treasury.finance_bank_statement_lines
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_banks
ALTER TABLE treasury.finance_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_banks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_banks;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_banks;
CREATE POLICY tenant_isolation_policy ON treasury.finance_banks
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_challans
ALTER TABLE treasury.finance_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_challans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_challans;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_challans;
CREATE POLICY tenant_isolation_policy ON treasury.finance_challans
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_debt
ALTER TABLE treasury.finance_debt ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_debt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_debt;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_debt;
CREATE POLICY tenant_isolation_policy ON treasury.finance_debt
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_deposit_events
ALTER TABLE treasury.finance_deposit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_deposit_events;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_deposit_events;
CREATE POLICY tenant_isolation_policy ON treasury.finance_deposit_events
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_deposits
ALTER TABLE treasury.finance_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_deposits;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_deposits;
CREATE POLICY tenant_isolation_policy ON treasury.finance_deposits
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_guarantees
ALTER TABLE treasury.finance_guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_guarantees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_guarantees;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_guarantees;
CREATE POLICY tenant_isolation_policy ON treasury.finance_guarantees
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- treasury.finance_instruments
ALTER TABLE treasury.finance_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury.finance_instruments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON treasury.finance_instruments;
DROP POLICY IF EXISTS tenant_isolation ON treasury.finance_instruments;
CREATE POLICY tenant_isolation_policy ON treasury.finance_instruments
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = budget.current_tenant_id())
      WITH CHECK (tenant_id = budget.current_tenant_id())';
  END IF;
END $$;
