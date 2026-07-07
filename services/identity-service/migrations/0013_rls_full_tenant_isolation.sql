-- RLS completion: full tenant isolation (USING + WITH CHECK) for identity-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION users.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- apikeys.api_key_audit
ALTER TABLE apikeys.api_key_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE apikeys.api_key_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON apikeys.api_key_audit;
DROP POLICY IF EXISTS tenant_isolation ON apikeys.api_key_audit;
CREATE POLICY tenant_isolation_policy ON apikeys.api_key_audit
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- apikeys.api_keys
ALTER TABLE apikeys.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE apikeys.api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON apikeys.api_keys;
DROP POLICY IF EXISTS tenant_isolation ON apikeys.api_keys;
CREATE POLICY tenant_isolation_policy ON apikeys.api_keys
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- breakglass.grants
ALTER TABLE breakglass.grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakglass.grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON breakglass.grants;
DROP POLICY IF EXISTS tenant_isolation ON breakglass.grants;
CREATE POLICY tenant_isolation_policy ON breakglass.grants
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- devices.entity_changelog
ALTER TABLE devices.entity_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices.entity_changelog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON devices.entity_changelog;
DROP POLICY IF EXISTS tenant_isolation ON devices.entity_changelog;
CREATE POLICY tenant_isolation_policy ON devices.entity_changelog
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- devices.mailbox_cursors
ALTER TABLE devices.mailbox_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices.mailbox_cursors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON devices.mailbox_cursors;
DROP POLICY IF EXISTS tenant_isolation ON devices.mailbox_cursors;
CREATE POLICY tenant_isolation_policy ON devices.mailbox_cursors
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- devices.processed_mutations
ALTER TABLE devices.processed_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices.processed_mutations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON devices.processed_mutations;
DROP POLICY IF EXISTS tenant_isolation ON devices.processed_mutations;
CREATE POLICY tenant_isolation_policy ON devices.processed_mutations
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- devices.registered_devices
ALTER TABLE devices.registered_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices.registered_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON devices.registered_devices;
DROP POLICY IF EXISTS tenant_isolation ON devices.registered_devices;
CREATE POLICY tenant_isolation_policy ON devices.registered_devices
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- mfa.configs
ALTER TABLE mfa.configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa.configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON mfa.configs;
DROP POLICY IF EXISTS tenant_isolation ON mfa.configs;
CREATE POLICY tenant_isolation_policy ON mfa.configs
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- rbac.permissions
ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rbac.permissions;
DROP POLICY IF EXISTS tenant_isolation ON rbac.permissions;
CREATE POLICY tenant_isolation_policy ON rbac.permissions
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- rbac.role_assignment_history
ALTER TABLE rbac.role_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_assignment_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rbac.role_assignment_history;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_assignment_history;
CREATE POLICY tenant_isolation_policy ON rbac.role_assignment_history
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- rbac.role_assignments
ALTER TABLE rbac.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rbac.role_assignments;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_assignments;
CREATE POLICY tenant_isolation_policy ON rbac.role_assignments
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- rbac.role_permissions
ALTER TABLE rbac.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rbac.role_permissions;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_permissions;
CREATE POLICY tenant_isolation_policy ON rbac.role_permissions
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- rbac.roles
ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rbac.roles;
DROP POLICY IF EXISTS tenant_isolation ON rbac.roles;
CREATE POLICY tenant_isolation_policy ON rbac.roles
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- sessions.sessions
ALTER TABLE sessions.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions.sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON sessions.sessions;
DROP POLICY IF EXISTS tenant_isolation ON sessions.sessions;
CREATE POLICY tenant_isolation_policy ON sessions.sessions
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- users.service_accounts
ALTER TABLE users.service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.service_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.service_accounts;
DROP POLICY IF EXISTS tenant_isolation ON users.service_accounts;
CREATE POLICY tenant_isolation_policy ON users.service_accounts
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- users.users
ALTER TABLE users.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.users;
DROP POLICY IF EXISTS tenant_isolation ON users.users;
CREATE POLICY tenant_isolation_policy ON users.users
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = users.current_tenant_id())
      WITH CHECK (tenant_id = users.current_tenant_id())';
  END IF;
END $$;
