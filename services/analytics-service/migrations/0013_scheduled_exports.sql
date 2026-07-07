-- 0013_scheduled_exports.sql
-- Purpose: Create the scheduled_exports table for recurring export configuration.
-- Rollback: DROP TABLE IF EXISTS analytics.scheduled_exports;
-- Affected services: analytics-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS analytics.scheduled_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  query_run_id UUID NOT NULL,
  format VARCHAR(8) NOT NULL DEFAULT 'csv',
  cadence VARCHAR(16) NOT NULL DEFAULT 'daily',
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Cadence CHECK constraint: only valid values
ALTER TABLE analytics.scheduled_exports
  DROP CONSTRAINT IF EXISTS chk_scheduled_exports_cadence;
ALTER TABLE analytics.scheduled_exports
  ADD CONSTRAINT chk_scheduled_exports_cadence
  CHECK (cadence IN ('hourly', 'daily', 'weekly', 'monthly'));

-- Format CHECK constraint
ALTER TABLE analytics.scheduled_exports
  DROP CONSTRAINT IF EXISTS chk_scheduled_exports_format;
ALTER TABLE analytics.scheduled_exports
  ADD CONSTRAINT chk_scheduled_exports_format
  CHECK (format IN ('csv', 'json'));

-- RLS enforcement
ALTER TABLE analytics.scheduled_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.scheduled_exports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON analytics.scheduled_exports;
CREATE POLICY tenant_isolation ON analytics.scheduled_exports
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Index for the cron sweeper: enabled + nextRunAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_exports_due
  ON analytics.scheduled_exports (next_run_at)
  WHERE enabled = true;

-- Tenant lookup index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_exports_tenant
  ON analytics.scheduled_exports (tenant_id);
