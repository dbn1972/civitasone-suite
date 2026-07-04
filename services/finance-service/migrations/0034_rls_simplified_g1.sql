-- 0034_rls_simplified_g1.sql
-- G1 RLS Completion: Enable row-level security on remaining tables missed
-- by 0019/0020/0033:
--   simplified.accounts, simplified.transactions (from 0031)
--   payments.finance_grn_match (from 0025)
--   gl.finance_fiscal_years (from 0022)
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.
-- Uses the budget.current_tenant_id() function established in 0019.

BEGIN;

-- ============================================================
-- Schema: simplified (from 0031)
-- ============================================================

-- simplified.accounts
ALTER TABLE simplified.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE simplified.accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON simplified.accounts;
CREATE POLICY tenant_isolation ON simplified.accounts
  USING (tenant_id = budget.current_tenant_id());

-- simplified.transactions
ALTER TABLE simplified.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE simplified.transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON simplified.transactions;
CREATE POLICY tenant_isolation ON simplified.transactions
  USING (tenant_id = budget.current_tenant_id());

-- ============================================================
-- Schema: payments (finance_grn_match from 0025)
-- ============================================================

ALTER TABLE payments.finance_grn_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_grn_match FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payments.finance_grn_match;
CREATE POLICY tenant_isolation ON payments.finance_grn_match
  USING (tenant_id = budget.current_tenant_id());

-- ============================================================
-- Schema: gl (finance_fiscal_years from 0022)
-- ============================================================

ALTER TABLE gl.finance_fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_fiscal_years FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_fiscal_years;
CREATE POLICY tenant_isolation ON gl.finance_fiscal_years
  USING (tenant_id = budget.current_tenant_id());

COMMIT;
