-- Purpose: Add analytics tracking tables (append-only events + materialized metrics)
-- Rollback: DROP SCHEMA analytics CASCADE;
-- Affected services: notification-service (analytics module, delivery pipeline instrumentation)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.open_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  delivery_id  uuid NOT NULL,
  opened_at    timestamptz NOT NULL DEFAULT now()
);

-- Deduplicate: one open per delivery
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_unique_delivery
  ON analytics.open_events (delivery_id);

CREATE TABLE IF NOT EXISTS analytics.click_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  delivery_id  uuid NOT NULL,
  link_url     text NOT NULL,
  clicked_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_click_delivery
  ON analytics.click_events (delivery_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_click_tenant_time
  ON analytics.click_events (tenant_id, clicked_at);

CREATE TABLE IF NOT EXISTS analytics.delivery_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  template_id   uuid,
  campaign_id   uuid,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  sent_count    integer NOT NULL DEFAULT 0,
  open_count    integer NOT NULL DEFAULT 0,
  click_count   integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_lookup
  ON analytics.delivery_metrics (tenant_id, template_id, period_start);

-- Enable RLS for tenant isolation
ALTER TABLE analytics.open_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS analytics_open_tenant_isolation
  ON analytics.open_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE analytics.click_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS analytics_click_tenant_isolation
  ON analytics.click_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE analytics.delivery_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS analytics_metrics_tenant_isolation
  ON analytics.delivery_metrics
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
