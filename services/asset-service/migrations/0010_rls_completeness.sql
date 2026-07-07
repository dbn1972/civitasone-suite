-- RLS completeness: cover tables missing full enforcement after 0009_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy (USING + WITH CHECK) for
--          enterprise.cash_generating_units, enterprise.impairment_tests,
--          lifecycle.inter_org_transfers (upgrade from USING-only)
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- enterprise.cash_generating_units
ALTER TABLE enterprise.cash_generating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cash_generating_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.cash_generating_units;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.cash_generating_units;
CREATE POLICY tenant_isolation_policy ON enterprise.cash_generating_units
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- enterprise.impairment_tests
ALTER TABLE enterprise.impairment_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.impairment_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.impairment_tests;
DROP POLICY IF EXISTS tenant_isolation ON enterprise.impairment_tests;
CREATE POLICY tenant_isolation_policy ON enterprise.impairment_tests
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());

-- lifecycle.inter_org_transfers (upgrade from USING-only to USING + WITH CHECK)
ALTER TABLE lifecycle.inter_org_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle.inter_org_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON lifecycle.inter_org_transfers;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle.inter_org_transfers;
CREATE POLICY tenant_isolation_policy ON lifecycle.inter_org_transfers
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
