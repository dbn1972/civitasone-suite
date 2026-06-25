-- analytics-service migration 0002 — production hardening.
-- Applied with analytics_svc on civitas_analytics. Idempotent (IF NOT EXISTS everywhere).
--
-- DB-per-service rule (L1): analytics owns these tables and reads ONLY its own
-- projection (analytics.fact_events), which is populated by consuming domain
-- events. analytics NEVER queries another service's database.

-- ── dashboards: access control (owner/shared) + layout ──────────────────────
ALTER TABLE analytics.dashboards ADD COLUMN IF NOT EXISTS owner_id   uuid;
ALTER TABLE analytics.dashboards ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'private';
ALTER TABLE analytics.dashboards ADD COLUMN IF NOT EXISTS layout     jsonb NOT NULL DEFAULT '{}'::jsonb;
-- backfill owner for legacy rows so access checks have a deterministic owner.
UPDATE analytics.dashboards SET owner_id = created_by WHERE owner_id IS NULL;

-- ── dashboard widgets (a dashboard is a layout of widgets over saved specs) ──
CREATE TABLE IF NOT EXISTS analytics.dashboard_widgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  dashboard_id uuid NOT NULL REFERENCES analytics.dashboards(id) ON DELETE CASCADE,
  title        varchar(200) NOT NULL,
  viz_type     varchar(24)  NOT NULL DEFAULT 'table',   -- table | bar | line | stat
  spec         jsonb        NOT NULL,                     -- a registry-validated QuerySpec
  position     integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_widgets_tenant    ON analytics.dashboard_widgets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_widgets_dashboard ON analytics.dashboard_widgets(tenant_id, dashboard_id);

-- ── dashboard shares (explicit grants for non-owners) ───────────────────────
CREATE TABLE IF NOT EXISTS analytics.dashboard_shares (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  dashboard_id uuid NOT NULL REFERENCES analytics.dashboards(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,                              -- user the dashboard is shared with
  access       varchar(16) NOT NULL DEFAULT 'view',        -- view | edit
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_share_principal ON analytics.dashboard_shares(tenant_id, dashboard_id, principal_id);
CREATE INDEX IF NOT EXISTS idx_shares_tenant ON analytics.dashboard_shares(tenant_id);

-- ── saved metrics (named, tenant-scoped metric definitions over the registry) ─
CREATE TABLE IF NOT EXISTS analytics.saved_metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(200) NOT NULL,
  metric_key  varchar(64)  NOT NULL,                       -- a whitelisted base metric key
  spec        jsonb        NOT NULL,                        -- dimensions/filters/dateRange (registry-validated)
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_metric_name ON analytics.saved_metrics(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_saved_metrics_tenant ON analytics.saved_metrics(tenant_id);

-- ── fact_events: analytics' OWN projection of cross-domain events ────────────
-- Populated idempotently by the facts ingestion consumer. The whitelisted query
-- builder runs ONLY against this table — never user SQL, never other DBs.
CREATE TABLE IF NOT EXISTS analytics.fact_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  source      varchar(32)  NOT NULL,                        -- finance | grants | procurement | ...
  event_type  varchar(64)  NOT NULL,                        -- e.g. payment.released
  category    varchar(64)  NOT NULL DEFAULT 'general',
  status      varchar(32)  NOT NULL DEFAULT 'unknown',
  amount      numeric(18,2) NOT NULL DEFAULT 0,
  occurred_at timestamptz  NOT NULL DEFAULT now(),
  dedupe_key  varchar(128) NOT NULL,                        -- source message id (idempotency)
  ingested_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fact_dedupe   ON analytics.fact_events(tenant_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_fact_tenant_time    ON analytics.fact_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fact_tenant_source  ON analytics.fact_events(tenant_id, source);

-- ── query_runs: results history (spec + result snapshot + kind) ─────────────
ALTER TABLE analytics.query_runs ADD COLUMN IF NOT EXISTS spec   jsonb       NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE analytics.query_runs ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE analytics.query_runs ADD COLUMN IF NOT EXISTS kind   varchar(16) NOT NULL DEFAULT 'adhoc';   -- adhoc | scheduled
ALTER TABLE analytics.query_runs ADD COLUMN IF NOT EXISTS error  varchar(500);
CREATE INDEX IF NOT EXISTS idx_query_runs_tenant_time ON analytics.query_runs(tenant_id, created_at);

-- ── scheduled queries (recurring runs of a spec) ────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.scheduled_queries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(200) NOT NULL,
  spec        jsonb        NOT NULL,
  cadence     varchar(16)  NOT NULL DEFAULT 'daily',        -- hourly | daily | weekly | monthly
  enabled     boolean      NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_scheduled_tenant ON analytics.scheduled_queries(tenant_id);

-- ── export jobs (materialise a query_run into a downloadable artifact) ───────
CREATE TABLE IF NOT EXISTS analytics.export_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  query_run_id  uuid REFERENCES analytics.query_runs(id),
  format        varchar(8)   NOT NULL DEFAULT 'csv',         -- csv | xlsx | json
  status        varchar(16)  NOT NULL DEFAULT 'queued',      -- queued | running | completed | failed
  row_count     integer,
  download_url  varchar(1024),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant ON analytics.export_jobs(tenant_id);
