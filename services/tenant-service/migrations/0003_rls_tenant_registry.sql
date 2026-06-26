-- Additive, idempotent. Safe to re-run.
-- Applies RLS to tenant.tenants with a super-admin escape hatch:
--   - Regular tenant session: can only see/write their own row (tenant_id matches)
--   - Super-admin session (no app.tenant_id set → current_tenant_id() IS NULL): sees all rows

CREATE OR REPLACE FUNCTION tenant.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE tenant.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant.tenants;
CREATE POLICY tenant_isolation ON tenant.tenants
  USING (
    tenant_id = tenant.current_tenant_id()
    OR tenant.current_tenant_id() IS NULL
  );
