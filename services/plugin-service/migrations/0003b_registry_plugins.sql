-- Migration: 0003b_registry_plugins.sql
-- Purpose: Creates the registry.plugins table (installed-plugin registry:
--          manifest, lifecycle state, config). Declared in
--          src/modules/registry/schema.ts (registrySchema.plugins) and already
--          referenced by migration 0004's RLS policy and 0006's state CHECK
--          constraint (both guarded/no-op without it), but no prior migration
--          ever created it — a pre-existing gap explicitly documented in
--          0006_check_constraints_status_columns.sql. This supplies the table
--          those migrations were always meant to sit on top of.
-- Rollback: DROP TABLE IF EXISTS registry.plugins; DROP SCHEMA IF EXISTS registry;
-- Affected services: plugin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS registry AUTHORIZATION plugin_svc;

CREATE TABLE IF NOT EXISTS registry.plugins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  manifest_json  JSONB NOT NULL,
  state          VARCHAR(24) NOT NULL DEFAULT 'uploaded',
  installed_at   TIMESTAMPTZ,
  enabled_at     TIMESTAMPTZ,
  disabled_at    TIMESTAMPTZ,
  config         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL,
  updated_by     UUID NOT NULL,
  version        INT NOT NULL DEFAULT 1
);

-- RLS enforcement for tenant isolation. current_tenant_id() is defined in
-- 0003_rls_tenant_isolation.sql (which sorts before this file); recreated
-- defensively so this migration is self-contained.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE registry.plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry.plugins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON registry.plugins;
DROP POLICY IF EXISTS tenant_isolation ON registry.plugins;
CREATE POLICY tenant_isolation_policy ON registry.plugins
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Standard indexes.
CREATE INDEX IF NOT EXISTS idx_plugins_tenant ON registry.plugins (tenant_id);

-- Grants: migrations run as civitas_admin (see scripts/dev/migrate-all.mjs),
-- so — despite the AUTHORIZATION clause above — a fresh cluster where
-- `registry` didn't already exist under a different owner is the only case
-- that clause actually takes effect; on this codebase's dev/CI cluster the
-- schema already existed (civitas_admin-owned) by the time this migration
-- ran, so AUTHORIZATION was a no-op and plugin_svc was left with zero
-- privileges here ("permission denied for schema registry" on every
-- request), identical to the sibling hooks.plugin_hooks gap in 0003a. This
-- service's tables otherwise rely on scripts/dev/grant-all.mjs running after
-- ALL services' migrations succeed fleet-wide to pick this up — a step that
-- is silently skipped in full if even one unrelated service's migration
-- fails. Granting explicitly here — matching the established pattern in
-- theme-service/migrations/0004_brand_config.sql — makes this migration
-- self-sufficient regardless of whether AUTHORIZATION took effect or whether
-- the fleet-wide grant step ran.
GRANT USAGE ON SCHEMA registry TO plugin_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON registry.plugins TO plugin_svc;
