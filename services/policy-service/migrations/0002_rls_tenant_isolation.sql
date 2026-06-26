-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all tables with a tenant_id column.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- roles.roles
ALTER TABLE roles.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles.roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles.roles;
CREATE POLICY tenant_isolation ON roles.roles
  USING (tenant_id = current_tenant_id());

-- roles.permissions
ALTER TABLE roles.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles.permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles.permissions;
CREATE POLICY tenant_isolation ON roles.permissions
  USING (tenant_id = current_tenant_id());

-- bindings.bindings
ALTER TABLE bindings.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bindings.bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bindings.bindings;
CREATE POLICY tenant_isolation ON bindings.bindings
  USING (tenant_id = current_tenant_id());

-- bindings.breakglass
ALTER TABLE bindings.breakglass ENABLE ROW LEVEL SECURITY;
ALTER TABLE bindings.breakglass FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bindings.breakglass;
CREATE POLICY tenant_isolation ON bindings.breakglass
  USING (tenant_id = current_tenant_id());

-- abac.rules
ALTER TABLE abac.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE abac.rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON abac.rules;
CREATE POLICY tenant_isolation ON abac.rules
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());
