-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on plugin.installs
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON plugin.installs; recreate with USING-only.

SET lock_timeout = '5s';

-- plugin.installs
ALTER TABLE plugin.installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin.installs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plugin.installs;
DROP POLICY IF EXISTS tenant_isolation ON plugin.installs;
CREATE POLICY tenant_isolation_policy ON plugin.installs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
