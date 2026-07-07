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

-- RLS enforcement for tenant isolation
ALTER TABLE store.plugin_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.plugin_stores FORCE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS tenant_isolation ON store.plugin_stores
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_plugin_stores_tenant_plugin
  ON store.plugin_stores (tenant_id, plugin_id);

CREATE INDEX IF NOT EXISTS idx_plugin_stores_tenant_plugin_key
  ON store.plugin_stores (tenant_id, plugin_id, key);
