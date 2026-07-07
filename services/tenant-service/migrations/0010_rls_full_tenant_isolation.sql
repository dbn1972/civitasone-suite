-- RLS completion: full tenant isolation (USING + WITH CHECK) for tenant-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- plans.plans
ALTER TABLE plans.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans.plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plans.plans;
DROP POLICY IF EXISTS tenant_isolation ON plans.plans;
CREATE POLICY tenant_isolation_policy ON plans.plans
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- quotas.quotas
ALTER TABLE quotas.quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotas.quotas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON quotas.quotas;
DROP POLICY IF EXISTS tenant_isolation ON quotas.quotas;
CREATE POLICY tenant_isolation_policy ON quotas.quotas
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- settings.tenant_settings
ALTER TABLE settings.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON settings.tenant_settings;
DROP POLICY IF EXISTS tenant_isolation ON settings.tenant_settings;
CREATE POLICY tenant_isolation_policy ON settings.tenant_settings
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- subscriptions.subscriptions
ALTER TABLE subscriptions.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON subscriptions.subscriptions;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions.subscriptions;
CREATE POLICY tenant_isolation_policy ON subscriptions.subscriptions
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- tenant.tenant_quotas
ALTER TABLE tenant.tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenant_quotas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.tenant_quotas;
DROP POLICY IF EXISTS tenant_isolation ON tenant.tenant_quotas;
CREATE POLICY tenant_isolation_policy ON tenant.tenant_quotas
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- tenant.tenants
ALTER TABLE tenant.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.tenants;
DROP POLICY IF EXISTS tenant_isolation ON tenant.tenants;
CREATE POLICY tenant_isolation_policy ON tenant.tenants
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = tenant.current_tenant_id())
      WITH CHECK (tenant_id = tenant.current_tenant_id())';
  END IF;
END $$;
