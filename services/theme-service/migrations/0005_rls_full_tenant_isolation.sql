-- RLS completion: full tenant isolation (USING + WITH CHECK) for theme-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- branding.tenant_branding
ALTER TABLE branding.tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding.tenant_branding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON branding.tenant_branding;
DROP POLICY IF EXISTS tenant_isolation ON branding.tenant_branding;
CREATE POLICY tenant_isolation_policy ON branding.tenant_branding
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- templates.templates
ALTER TABLE templates.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON templates.templates;
DROP POLICY IF EXISTS tenant_isolation ON templates.templates;
CREATE POLICY tenant_isolation_policy ON templates.templates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- theme.brand_config
ALTER TABLE theme.brand_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.brand_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON theme.brand_config;
DROP POLICY IF EXISTS tenant_isolation ON theme.brand_config;
CREATE POLICY tenant_isolation_policy ON theme.brand_config
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- theme.tokens
ALTER TABLE theme.tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON theme.tokens;
DROP POLICY IF EXISTS tenant_isolation ON theme.tokens;
CREATE POLICY tenant_isolation_policy ON theme.tokens
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
