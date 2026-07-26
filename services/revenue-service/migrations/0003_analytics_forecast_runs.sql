-- revenue-service migration 0003 — analytics forecast runs (SVC-140)
-- Additive + idempotent. Applied AFTER 0002_rls_tenant_isolation.sql.
-- Rollback: DROP TABLE analytics.forecast_runs; DROP SCHEMA analytics;

CREATE SCHEMA IF NOT EXISTS analytics;

-- ── analytics.forecast_runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.forecast_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  rate_head_id     uuid,
  method           varchar(24) NOT NULL,
  granularity      varchar(12) NOT NULL,
  horizon          integer NOT NULL,
  param            integer NOT NULL DEFAULT 3,
  history_periods  integer NOT NULL,
  history_series   jsonb NOT NULL DEFAULT '[]'::jsonb,
  projections      jsonb NOT NULL DEFAULT '[]'::jsonb,
  mad_minor        bigint NOT NULL,
  confidence_bps   integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_tenant_created
  ON analytics.forecast_runs(tenant_id, created_at DESC);

-- ── RLS tenant isolation (FORCE) ───────────────────────────────────────────────
ALTER TABLE analytics.forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.forecast_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics.forecast_runs;
CREATE POLICY tenant_isolation ON analytics.forecast_runs
  USING (tenant_id = rates.current_tenant_id());
