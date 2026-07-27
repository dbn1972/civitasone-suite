-- Purpose: Add recipient segment definitions for targeted notifications
-- Rollback: DROP SCHEMA segments CASCADE;
-- Affected services: notification-service (segments module)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS segments;

CREATE TABLE IF NOT EXISTS segments.recipient_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(128) NOT NULL,
  description text,
  criteria    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segment_tenant
  ON segments.recipient_segments (tenant_id);

-- Enable RLS for tenant isolation
ALTER TABLE segments.recipient_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS segments_tenant_isolation ON segments.recipient_segments;
CREATE POLICY segments_tenant_isolation
  ON segments.recipient_segments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
