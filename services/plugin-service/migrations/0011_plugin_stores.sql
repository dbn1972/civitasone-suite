-- Migration: 0011_plugin_stores.sql
-- Purpose: Creates the store schema and plugin_stores table for per-tenant
--          per-plugin key-value storage with 100MB quota enforcement.
-- Rollback: DROP TABLE IF EXISTS store.plugin_stores; DROP SCHEMA IF EXISTS store;
-- Affected services: plugin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS store;

CREATE TABLE IF NOT EXISTS store.plugin_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  plugin_id UUID NOT NULL,
  key VARCHAR(256) NOT NULL,
  value JSONB NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  -- Unique constraint: one key per plugin per tenant
  CONSTRAINT uq_plugin_stores_tenant_plugin_key UNIQUE (tenant_id, plugin_id, key)
);

-- RLS enforcement for tenant isolation. current_tenant_id() is defined in
-- 0003_rls_tenant_isolation.sql (which sorts before this file); recreated
-- defensively so this migration is self-contained. Uses the helper rather
-- than a bare `current_setting('app.tenant_id')::uuid` — every other table
-- in this service (and codebase) goes through current_tenant_id(), which
-- treats a missing/blank GUC as NULL (policy evaluates to false, zero rows)
-- via `current_setting(..., true)` + NULLIF. The bare form used `missing_ok
-- = false` (the 1-arg call) and cast '' straight to uuid, so any session that
-- hasn't set app.tenant_id yet raised a hard Postgres ERROR instead of a
-- clean empty result — same tenant-isolation guarantee, but an inconsistent,
-- surprising failure mode relative to every sibling table.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE store.plugin_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.plugin_stores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON store.plugin_stores;
CREATE POLICY tenant_isolation
  ON store.plugin_stores
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_plugin_stores_tenant_plugin
  ON store.plugin_stores (tenant_id, plugin_id);

CREATE INDEX IF NOT EXISTS idx_plugin_stores_tenant_plugin_key
  ON store.plugin_stores (tenant_id, plugin_id, key);
