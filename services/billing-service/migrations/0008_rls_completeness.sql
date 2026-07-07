-- RLS completeness: cover tables added after 0006_rls_full_tenant_isolation.sql
-- Purpose: Add ENABLE RLS + FORCE RLS + tenant_isolation_policy for
--          payments.billing_dunning_attempts
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON payments.billing_dunning_attempts; ALTER TABLE payments.billing_dunning_attempts DISABLE ROW LEVEL SECURITY;

SET lock_timeout = '5s';

-- payments.billing_dunning_attempts
ALTER TABLE payments.billing_dunning_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.billing_dunning_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.billing_dunning_attempts;
DROP POLICY IF EXISTS tenant_isolation ON payments.billing_dunning_attempts;
CREATE POLICY tenant_isolation_policy ON payments.billing_dunning_attempts
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());
