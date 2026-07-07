-- Migration 0013: Create scheduled_reports table
-- Purpose: Supports cron-triggered report generation with delivery to recipients
-- Rollback: DROP TABLE IF EXISTS reports.scheduled_reports;
-- Affected services: report-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS reports.scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  template_id UUID NOT NULL,
  cadence VARCHAR(16) NOT NULL DEFAULT 'daily'
    CHECK (cadence IN ('hourly', 'daily', 'weekly', 'monthly')),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  format VARCHAR(8) NOT NULL DEFAULT 'pdf'
    CHECK (format IN ('pdf', 'xlsx', 'csv')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);

-- Indexes for the cron sweeper (find due enabled reports)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_reports_next_run
  ON reports.scheduled_reports (next_run_at)
  WHERE enabled = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_reports_tenant
  ON reports.scheduled_reports (tenant_id);

-- RLS enforcement
ALTER TABLE reports.scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.scheduled_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON reports.scheduled_reports
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Recipients array constraint (max 20 elements) enforced at application layer via zod validation.
-- DB-level check omitted because Drizzle JSONB serialization may wrap arrays in a way that
-- jsonb_array_length cannot evaluate. Route-boundary validation is the primary control.
