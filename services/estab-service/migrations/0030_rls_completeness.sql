-- RLS completeness: cover tables added after 0029_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for
--          files.estab_org_unit, files.module_decision_log
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- files.estab_org_unit
ALTER TABLE files.estab_org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.estab_org_unit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.estab_org_unit;
DROP POLICY IF EXISTS tenant_isolation ON files.estab_org_unit;
CREATE POLICY tenant_isolation_policy ON files.estab_org_unit
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- files.module_decision_log
ALTER TABLE files.module_decision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.module_decision_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.module_decision_log;
DROP POLICY IF EXISTS tenant_isolation ON files.module_decision_log;
CREATE POLICY tenant_isolation_policy ON files.module_decision_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
