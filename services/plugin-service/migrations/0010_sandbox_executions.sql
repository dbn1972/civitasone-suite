-- Migration: 0010_sandbox_executions.sql
-- Purpose: Creates the sandbox schema and plugin_executions table for tracking
--          sandboxed plugin execution history (timing, memory, status).
-- Rollback: DROP TABLE IF EXISTS sandbox.plugin_executions; DROP SCHEMA IF EXISTS sandbox;
-- Affected services: plugin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS sandbox;

CREATE TABLE IF NOT EXISTS sandbox.plugin_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  plugin_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  execution_time_ms INT NOT NULL,
  memory_used_mb REAL NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('success', 'timeout', 'error', 'oom')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- RLS enforcement for tenant isolation
ALTER TABLE sandbox.plugin_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox.plugin_executions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON sandbox.plugin_executions;
CREATE POLICY tenant_isolation
  ON sandbox.plugin_executions
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_plugin_executions_tenant_id ON sandbox.plugin_executions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_plugin_id ON sandbox.plugin_executions (plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_status ON sandbox.plugin_executions (status);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_started_at ON sandbox.plugin_executions (started_at DESC);
