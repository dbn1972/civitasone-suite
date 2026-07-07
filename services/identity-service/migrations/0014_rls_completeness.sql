-- RLS completeness: cover tables added after 0013_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for
--          public.identity_kc_reconciliations (created in 0010_security_remediation.sql)
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON identity_kc_reconciliations; ALTER TABLE identity_kc_reconciliations DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- public.identity_kc_reconciliations
ALTER TABLE identity_kc_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_kc_reconciliations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON identity_kc_reconciliations;
DROP POLICY IF EXISTS tenant_isolation ON identity_kc_reconciliations;
CREATE POLICY tenant_isolation_policy ON identity_kc_reconciliations
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- users.api_key_rotations (upgrade from USING-only to USING + WITH CHECK)
ALTER TABLE users.api_key_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.api_key_rotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.api_key_rotations;
DROP POLICY IF EXISTS tenant_isolation ON users.api_key_rotations;
CREATE POLICY tenant_isolation_policy ON users.api_key_rotations
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());
