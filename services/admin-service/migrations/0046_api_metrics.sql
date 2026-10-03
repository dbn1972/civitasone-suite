-- Migration: 0046_api_metrics.sql
-- Purpose: GAP-ADMIN-API-MONITORING-06 -- the in-house metrics source behind
--          GET /v1/admin/api-monitoring. The gateway aggregates per tenant /
--          service / endpoint / minute in memory and publishes batches; the
--          admin consumer adds them into this rollup (additive upsert, so
--          several gateway pods can flush the same minute). Latency is kept as
--          a fixed-bucket histogram (merge-safe) from which p50/p95 are read.
--          api_metrics_settings holds the per-tenant retention (default 30 days).
-- Rollback: DROP TABLE health.api_metrics_minute; DROP TABLE health.api_metrics_settings;
-- Affected services: admin-service, gateway-service (producer)
-- Idempotent: IF NOT EXISTS / DROP IF EXISTS throughout.

SET lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS health.api_metrics_minute (
  tenant_id       UUID NOT NULL,
  bucket_minute   TIMESTAMPTZ NOT NULL,
  service         VARCHAR(64) NOT NULL,
  endpoint        VARCHAR(200) NOT NULL,
  requests        INTEGER NOT NULL DEFAULT 0,
  errors_4xx      INTEGER NOT NULL DEFAULT 0,
  errors_5xx      INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms  BIGINT NOT NULL DEFAULT 0,
  -- counts per latency bucket (upper bounds in domain.ts LATENCY_BOUNDS_MS, plus one overflow bucket)
  latency_buckets INTEGER[] NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, bucket_minute, service, endpoint),
  CONSTRAINT api_metrics_minute_counts_check
    CHECK (requests >= 0 AND errors_4xx >= 0 AND errors_5xx >= 0 AND latency_sum_ms >= 0)
);

-- Per-endpoint lookups for one tenant and day (the daily distinct-endpoint cap reads this).
CREATE INDEX IF NOT EXISTS ix_api_metrics_minute_endpoint
  ON health.api_metrics_minute (tenant_id, service, endpoint, bucket_minute);

CREATE INDEX IF NOT EXISTS ix_api_metrics_minute_time
  ON health.api_metrics_minute (bucket_minute);

CREATE TABLE IF NOT EXISTS health.api_metrics_settings (
  tenant_id       UUID PRIMARY KEY,
  retention_days  INTEGER NOT NULL DEFAULT 30,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT api_metrics_settings_retention_check CHECK (retention_days BETWEEN 1 AND 365)
);

ALTER TABLE health.api_metrics_minute ENABLE ROW LEVEL SECURITY;
ALTER TABLE health.api_metrics_minute FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON health.api_metrics_minute;
CREATE POLICY tenant_isolation_policy ON health.api_metrics_minute
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- Platform-wide reads (a platform super-admin viewing every tenant, and the
-- retention sweeper discovering tenants): SELECT only, GUC set by trusted code.
DROP POLICY IF EXISTS platform_bypass_read_policy ON health.api_metrics_minute;
CREATE POLICY platform_bypass_read_policy ON health.api_metrics_minute
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

ALTER TABLE health.api_metrics_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE health.api_metrics_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON health.api_metrics_settings;
CREATE POLICY tenant_isolation_policy ON health.api_metrics_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS platform_bypass_read_policy ON health.api_metrics_settings;
CREATE POLICY platform_bypass_read_policy ON health.api_metrics_settings
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA health TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON health.api_metrics_minute TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON health.api_metrics_settings TO admin_svc;
  END IF;
END $$;
