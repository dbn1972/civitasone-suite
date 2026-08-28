-- Migration: 0003a_hooks_plugin_hooks.sql
-- Purpose: Creates the hooks.plugin_hooks table (event-hook registrations for
--          installed plugins). Declared in
--          src/modules/hooks/schema.ts (hooksSchema.plugin_hooks) and already
--          referenced by migration 0004's RLS policy and 0008's FK index, but
--          no prior migration ever created it — every read/write against this
--          module has been throwing `relation "hooks.plugin_hooks" does not
--          exist` on a fresh database. This supplies the table those
--          migrations were always meant to sit on top of.
-- Rollback: DROP TABLE IF EXISTS hooks.plugin_hooks; DROP SCHEMA IF EXISTS hooks;
-- Affected services: plugin-service

SET lock_timeout = '5s';

-- hooks schema is normally created by infra/db/bootstrap/bootstrap_missing_schemas.sql
-- (AUTHORIZATION plugin_svc); re-declared IF NOT EXISTS so this migration is
-- self-contained even if applied somewhere that bootstrap step hasn't reached.
CREATE SCHEMA IF NOT EXISTS hooks;

CREATE TABLE IF NOT EXISTS hooks.plugin_hooks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  plugin_id     UUID NOT NULL,
  event_type    VARCHAR(128) NOT NULL,
  handler_path  TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID NOT NULL,
  updated_by    UUID NOT NULL,
  version       INT NOT NULL DEFAULT 1
);

-- RLS enforcement for tenant isolation. current_tenant_id() is defined in
-- 0003_rls_tenant_isolation.sql (which sorts before this file); recreated
-- defensively so this migration is self-contained.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE hooks.plugin_hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hooks.plugin_hooks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON hooks.plugin_hooks;
DROP POLICY IF EXISTS tenant_isolation ON hooks.plugin_hooks;
CREATE POLICY tenant_isolation_policy ON hooks.plugin_hooks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Standard tenant index (plugin_id lookup index is added separately by
-- 0008_fk_indexes.sql via CREATE INDEX CONCURRENTLY).
CREATE INDEX IF NOT EXISTS idx_plugin_hooks_tenant ON hooks.plugin_hooks (tenant_id);

-- Grants: migrations run as civitas_admin (see scripts/dev/migrate-all.mjs),
-- so this schema/table are owned by civitas_admin, not plugin_svc — the role
-- plugin-service actually connects as. Every other module in this service
-- (and this table's own sibling migrations 0010/0011) relies on
-- scripts/dev/grant-all.mjs running after ALL services' migrations succeed to
-- pick this up. That step is skipped fleet-wide if even one unrelated
-- service's migration fails, which is exactly what left plugin_svc with zero
-- privileges on this schema in practice ("permission denied for schema
-- hooks" on every request) despite the table existing. Granting explicitly
-- here — matching the established pattern in
-- theme-service/migrations/0004_brand_config.sql — makes this migration
-- self-sufficient instead of depending on a separate, easy-to-skip fleet-wide
-- step.
GRANT USAGE ON SCHEMA hooks TO plugin_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON hooks.plugin_hooks TO plugin_svc;
