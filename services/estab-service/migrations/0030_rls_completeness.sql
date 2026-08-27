-- RLS completeness: cover tables added after 0029_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for
--          files.module_decision_log
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;
--
-- NOTE: this originally also covered files.estab_org_unit, but that table was
-- dropped by 0027_drop_org_unit_use_hrms.sql (estab-service switched to
-- referencing hrms_departments by cross-service UUID instead of owning its own
-- org-unit tree). 0027 sorts before this file, so on any fresh apply
-- files.estab_org_unit never exists here. Removed rather than recreated — the
-- retirement in 0027 was deliberate, not a gap to backfill.

SET lock_timeout = '5s';

-- files.module_decision_log
ALTER TABLE files.module_decision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE files.module_decision_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON files.module_decision_log;
DROP POLICY IF EXISTS tenant_isolation ON files.module_decision_log;
CREATE POLICY tenant_isolation_policy ON files.module_decision_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
