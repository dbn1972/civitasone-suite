-- 0033_rls_completion_c3.sql
-- C3 RLS Completion: Enable row-level security on all remaining tables
-- that were introduced after the initial RLS migration (0019).
-- Idempotent: uses DROP POLICY IF EXISTS before CREATE POLICY.

BEGIN;

-- ============================================================
-- Schema: gl
-- ============================================================

-- gl.finance_journal_lines (from 0030_denormalize_read_models.sql)
ALTER TABLE gl.finance_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_journal_lines;
CREATE POLICY tenant_isolation ON gl.finance_journal_lines USING (tenant_id = budget.current_tenant_id());

-- gl.finance_opening_balances (from 0022_fy_opening_balance.sql)
ALTER TABLE gl.finance_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.finance_opening_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gl.finance_opening_balances;
CREATE POLICY tenant_isolation ON gl.finance_opening_balances USING (tenant_id = budget.current_tenant_id());

-- ============================================================
-- Schema: budget
-- ============================================================

-- budget.finance_reappropriations (from 0023_reappropriation_request.sql)
ALTER TABLE budget.finance_reappropriations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.finance_reappropriations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON budget.finance_reappropriations;
CREATE POLICY tenant_isolation ON budget.finance_reappropriations USING (tenant_id = budget.current_tenant_id());

-- budget.head_utilisation (from 0030_denormalize_read_models.sql)
ALTER TABLE budget.head_utilisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget.head_utilisation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON budget.head_utilisation;
CREATE POLICY tenant_isolation ON budget.head_utilisation USING (tenant_id = budget.current_tenant_id());

-- ============================================================
-- Schema: org
-- ============================================================

-- org.legal_entities
ALTER TABLE org.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.legal_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org.legal_entities;
CREATE POLICY tenant_isolation ON org.legal_entities USING (tenant_id = budget.current_tenant_id());

-- org.operating_units
ALTER TABLE org.operating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.operating_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org.operating_units;
CREATE POLICY tenant_isolation ON org.operating_units USING (tenant_id = budget.current_tenant_id());

-- org.cost_centers
ALTER TABLE org.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.cost_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org.cost_centers;
CREATE POLICY tenant_isolation ON org.cost_centers USING (tenant_id = budget.current_tenant_id());

-- org.profit_centers
ALTER TABLE org.profit_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.profit_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org.profit_centers;
CREATE POLICY tenant_isolation ON org.profit_centers USING (tenant_id = budget.current_tenant_id());

-- org.purchasing_orgs
ALTER TABLE org.purchasing_orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.purchasing_orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org.purchasing_orgs;
CREATE POLICY tenant_isolation ON org.purchasing_orgs USING (tenant_id = budget.current_tenant_id());

COMMIT;
