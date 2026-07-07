-- RLS completion: full tenant isolation (USING + WITH CHECK) for policy-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- abac.rules
ALTER TABLE abac.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE abac.rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON abac.rules;
DROP POLICY IF EXISTS tenant_isolation ON abac.rules;
CREATE POLICY tenant_isolation_policy ON abac.rules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- bindings.bindings
ALTER TABLE bindings.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bindings.bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON bindings.bindings;
DROP POLICY IF EXISTS tenant_isolation ON bindings.bindings;
CREATE POLICY tenant_isolation_policy ON bindings.bindings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- bindings.breakglass
ALTER TABLE bindings.breakglass ENABLE ROW LEVEL SECURITY;
ALTER TABLE bindings.breakglass FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON bindings.breakglass;
DROP POLICY IF EXISTS tenant_isolation ON bindings.breakglass;
CREATE POLICY tenant_isolation_policy ON bindings.breakglass
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- role_features.role_feature_grants
ALTER TABLE role_features.role_feature_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_features.role_feature_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON role_features.role_feature_grants;
DROP POLICY IF EXISTS tenant_isolation ON role_features.role_feature_grants;
CREATE POLICY tenant_isolation_policy ON role_features.role_feature_grants
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- roles.permissions
ALTER TABLE roles.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles.permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON roles.permissions;
DROP POLICY IF EXISTS tenant_isolation ON roles.permissions;
CREATE POLICY tenant_isolation_policy ON roles.permissions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- roles.roles
ALTER TABLE roles.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON roles.roles;
DROP POLICY IF EXISTS tenant_isolation ON roles.roles;
CREATE POLICY tenant_isolation_policy ON roles.roles
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
