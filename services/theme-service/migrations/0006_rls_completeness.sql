-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on theme.revisions
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON theme.revisions; recreate with USING-only.

SET lock_timeout = '5s';

-- theme.revisions
ALTER TABLE theme.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON theme.revisions;
DROP POLICY IF EXISTS tenant_isolation ON theme.revisions;
CREATE POLICY tenant_isolation_policy ON theme.revisions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
