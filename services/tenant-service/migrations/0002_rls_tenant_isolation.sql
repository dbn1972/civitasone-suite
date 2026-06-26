-- tenant-service RLS migration: tenant isolation backstop
-- Role: tenant_svc on civitas_tenant
-- Applied AFTER 0001_init.sql
--
-- tenant.tenants is intentionally SKIPPED:
--   This table IS the tenant registry. Its tenant_id column is the tenant's own
--   identity, not a FK into another tenants table. Super-admin operations require
--   cross-tenant visibility (create, list, suspend tenants). Applying RLS here
--   would break platform administration. Isolation is enforced at the API layer.
--
-- Tables covered: _outbox.messages (tenant_id present on every row)
-- Skipped: tenant.tenants (registry; see above), _inbox.processed (no tenant_id)

CREATE OR REPLACE FUNCTION tenant.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- _outbox.messages — transactional outbox; each message is scoped to a tenant
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = tenant.current_tenant_id());
