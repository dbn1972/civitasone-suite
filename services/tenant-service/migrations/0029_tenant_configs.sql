-- 0029_tenant_configs.sql
--
-- tenant.tenant_configs is declared in Drizzle (src/modules/tenant/schema.ts)
-- and read/written by the registered tenant-extensions routes
-- (src/modules/tenant-extensions/routes.ts: modules, feature flags, billing),
-- but no migration ever created it, so those routes answered 500. Found by
-- scripts/ci/schema-drift-guard.mjs. Columns match schema.ts verbatim; one row
-- per tenant (tenant_id is the primary key, and routes.ts relies on that for
-- its INSERT ... ON CONFLICT DO NOTHING).
--
-- Additive and idempotent. Rollback: DROP TABLE IF EXISTS tenant.tenant_configs;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tenant.tenant_configs (
  tenant_id     uuid PRIMARY KEY,
  modules       jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

-- Tenant isolation (tenant.current_tenant_id() from 0010_rls_full_tenant_isolation.sql).
ALTER TABLE tenant.tenant_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenant_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.tenant_configs;
CREATE POLICY tenant_isolation_policy ON tenant.tenant_configs
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());
