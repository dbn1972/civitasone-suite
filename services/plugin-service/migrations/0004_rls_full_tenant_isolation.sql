-- RLS completion: full tenant isolation (USING + WITH CHECK) for plugin-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- hooks.plugin_hooks
ALTER TABLE hooks.plugin_hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hooks.plugin_hooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON hooks.plugin_hooks;
DROP POLICY IF EXISTS tenant_isolation ON hooks.plugin_hooks;
CREATE POLICY tenant_isolation_policy ON hooks.plugin_hooks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- plugin.items
ALTER TABLE plugin.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin.items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON plugin.items;
DROP POLICY IF EXISTS tenant_isolation ON plugin.items;
CREATE POLICY tenant_isolation_policy ON plugin.items
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- registry.plugins
ALTER TABLE registry.plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry.plugins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON registry.plugins;
DROP POLICY IF EXISTS tenant_isolation ON registry.plugins;
CREATE POLICY tenant_isolation_policy ON registry.plugins
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
