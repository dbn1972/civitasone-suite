-- identity-service RLS migration: tenant isolation backstop
-- Role: identity_svc on civitas_identity
-- Applied AFTER 0011_api_keys_break_glass.sql
-- Note: identity_kc_reconciliations is a root-schema table (no schema prefix) — skipped
--       as it is a system reconciliation table without tenant_id.

CREATE OR REPLACE FUNCTION users.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- users schema
ALTER TABLE users.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users.users;
CREATE POLICY tenant_isolation ON users.users USING (tenant_id = users.current_tenant_id());

ALTER TABLE users.service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.service_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users.service_accounts;
CREATE POLICY tenant_isolation ON users.service_accounts USING (tenant_id = users.current_tenant_id());

ALTER TABLE users.api_key_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.api_key_rotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users.api_key_rotations;
CREATE POLICY tenant_isolation ON users.api_key_rotations USING (tenant_id = users.current_tenant_id());

-- sessions schema
ALTER TABLE sessions.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions.sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sessions.sessions;
CREATE POLICY tenant_isolation ON sessions.sessions USING (tenant_id = users.current_tenant_id());

-- mfa schema
ALTER TABLE mfa.configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa.configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mfa.configs;
CREATE POLICY tenant_isolation ON mfa.configs USING (tenant_id = users.current_tenant_id());

-- devices schema
ALTER TABLE devices.registered_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices.registered_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON devices.registered_devices;
CREATE POLICY tenant_isolation ON devices.registered_devices USING (tenant_id = users.current_tenant_id());

-- sync schema
ALTER TABLE sync.mailbox_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.mailbox_cursors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync.mailbox_cursors;
CREATE POLICY tenant_isolation ON sync.mailbox_cursors USING (tenant_id = users.current_tenant_id());

ALTER TABLE sync.entity_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.entity_changelog FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync.entity_changelog;
CREATE POLICY tenant_isolation ON sync.entity_changelog USING (tenant_id = users.current_tenant_id());

ALTER TABLE sync.processed_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.processed_mutations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync.processed_mutations;
CREATE POLICY tenant_isolation ON sync.processed_mutations USING (tenant_id = users.current_tenant_id());

-- rbac schema
ALTER TABLE rbac.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rbac.roles;
CREATE POLICY tenant_isolation ON rbac.roles USING (tenant_id = users.current_tenant_id());

ALTER TABLE rbac.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rbac.permissions;
CREATE POLICY tenant_isolation ON rbac.permissions USING (tenant_id = users.current_tenant_id());

ALTER TABLE rbac.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_permissions;
CREATE POLICY tenant_isolation ON rbac.role_permissions USING (tenant_id = users.current_tenant_id());

ALTER TABLE rbac.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_assignments;
CREATE POLICY tenant_isolation ON rbac.role_assignments USING (tenant_id = users.current_tenant_id());

ALTER TABLE rbac.role_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac.role_assignment_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rbac.role_assignment_history;
CREATE POLICY tenant_isolation ON rbac.role_assignment_history USING (tenant_id = users.current_tenant_id());

-- apikeys schema
ALTER TABLE apikeys.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE apikeys.api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON apikeys.api_keys;
CREATE POLICY tenant_isolation ON apikeys.api_keys USING (tenant_id = users.current_tenant_id());

ALTER TABLE apikeys.api_key_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE apikeys.api_key_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON apikeys.api_key_audit;
CREATE POLICY tenant_isolation ON apikeys.api_key_audit USING (tenant_id = users.current_tenant_id());

-- breakglass schema
ALTER TABLE breakglass.grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakglass.grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON breakglass.grants;
CREATE POLICY tenant_isolation ON breakglass.grants USING (tenant_id = users.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = users.current_tenant_id());
