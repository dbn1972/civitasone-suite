-- RLS completeness: cover tables added after 0013_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for
--          para.audit_cag_paras
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON para.audit_cag_paras; ALTER TABLE para.audit_cag_paras DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- para.audit_cag_paras
ALTER TABLE para.audit_cag_paras ENABLE ROW LEVEL SECURITY;
ALTER TABLE para.audit_cag_paras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON para.audit_cag_paras;
DROP POLICY IF EXISTS tenant_isolation ON para.audit_cag_paras;
CREATE POLICY tenant_isolation_policy ON para.audit_cag_paras
  USING (tenant_id = events.current_tenant_id())
  WITH CHECK (tenant_id = events.current_tenant_id());
