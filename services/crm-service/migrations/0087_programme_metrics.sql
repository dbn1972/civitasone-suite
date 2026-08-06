-- Purpose: G12 (Spec §25.7, Journey J6) — per-programme, per-period execution health and
--   revenue. This is the table that makes "execution health per programme" (volume,
--   coverage, exception, grievance) and "revenue / SLA per programme" answerable at all.
--
--   One row = one metric for one programme over one period. Deliberately key/value rather
--   than a wide column-per-metric table: the metric set differs per programme type and per
--   tenant, and a new metric must not need a migration.
--
--   MONEY vs COUNTS. metric_kind decides which value column is populated:
--     - 'money' -> value_minor bigint, minor units (paise), with currency. NEVER float:
--       a revenue figure that loses precision is an audit finding.
--     - 'count' / 'ratio' -> value_numeric numeric, for volumes, coverage ratios,
--       exception rates and grievance rates.
--   The CHECK makes exactly one of them populated for the declared kind, so a reader
--   never has to guess which column carries the number.
--
--   DOUBLE-COUNTING. UNIQUE (tenant_id, programme_id, period_start, metric_key) exists so
--   a redelivered metric write, or an honest re-submission of a corrected figure, UPDATEs
--   the period's row instead of appending a second one. Without it, one requeued message
--   would silently double a programme's reported revenue.
--
-- Rollback:
--   DROP INDEX IF EXISTS crm.uq_programme_metrics_period_key;
--   DROP INDEX IF EXISTS crm.idx_programme_metrics_programme;
--   DROP TABLE IF EXISTS crm.programme_metrics;
--
-- Affected services: crm-service (programmes module). Emits
--   crm.programme_metric.recorded, consumed by audit-service through the outbox relay;
--   analytics/report services can subscribe without any schema change of their own.
--
-- Sequencing: additive — new tenant-scoped table. Depends on 0086_programmes.sql for the
--   parent table. No destructive change; safe to re-run.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.programme_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  metric_key varchar(64) NOT NULL,
  metric_kind varchar(8) NOT NULL CHECK (metric_kind IN ('money', 'count', 'ratio')),
  -- Monetary metrics only. bigint minor units; serialised as a STRING on the wire.
  value_minor bigint,
  currency char(3),
  -- Non-monetary metrics only (volumes, coverage/exception/grievance ratios).
  value_numeric numeric(20, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT programme_metrics_period_ordered CHECK (period_start <= period_end),
  -- Exactly one value column per kind, and currency only where money is meaningful.
  CONSTRAINT programme_metrics_value_matches_kind CHECK (
    (metric_kind = 'money' AND value_minor IS NOT NULL AND value_numeric IS NULL AND currency IS NOT NULL)
    OR
    (metric_kind <> 'money' AND value_numeric IS NOT NULL AND value_minor IS NULL AND currency IS NULL)
  )
);

-- The anti-double-count guard. Period is identified by its START: a programme reports one
-- value per metric per period, and period_end is descriptive of that same period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_metrics_period_key
  ON crm.programme_metrics (tenant_id, programme_id, period_start, metric_key);
CREATE INDEX IF NOT EXISTS idx_programme_metrics_programme
  ON crm.programme_metrics (tenant_id, programme_id, period_start DESC);

ALTER TABLE crm.programme_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.programme_metrics FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'programme_metrics_tenant_isolation'
      AND schemaname = 'crm' AND tablename = 'programme_metrics'
  ) THEN
    CREATE POLICY programme_metrics_tenant_isolation ON crm.programme_metrics
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.programme_metrics TO crm_svc;
  END IF;
END $g$;
