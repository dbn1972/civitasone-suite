-- Migration 0017: reports.metric_definitions — governed metric (KPI) definition catalogue (G4)
--
-- Purpose:
--   reports.kpis stores KPI *values* (target/current/unit/period) but nothing that
--   declares WHAT a metric means. Without a definition layer the ~14 measurement
--   points required by the customer journeys have nowhere to live, and two circles
--   computing "the same" KPI cannot be compared. This table adds the definition:
--   logical source, aggregation, allowed slice dimensions, period, governance and
--   version.
--
--   SECURITY: numerator_source / denominator_source are OPAQUE logical identifiers
--   (allowlist ^[a-z][a-z0-9_.]{2,199}$ enforced in the application domain layer).
--   They are NEVER executed or interpolated into SQL anywhere in this feature —
--   there is no query executor in this module.
--
--   Canonical (platform-standard) rows are seeded separately by
--   0018_canonical_journey_metrics.sql (schema and data migrations are kept apart
--   per the migration safety rules).
--
-- Rollback:
--   1. DROP POLICY IF EXISTS tenant_isolation_policy ON reports.metric_definitions;
--   2. DROP INDEX IF EXISTS reports.uq_metric_definitions_key_version;
--   3. DROP INDEX IF EXISTS reports.idx_metric_definitions_tenant_module;
--   4. DROP INDEX IF EXISTS reports.idx_metric_definitions_tenant_status;
--   5. DROP INDEX IF EXISTS reports.idx_metric_definitions_published_key;
--   6. DROP TABLE IF EXISTS reports.metric_definitions;
--   (Additive migration: dropping the table restores the previous schema exactly.)
--
-- Affected services: report-service (owner). Read-only consumers of the emitted
--   reports.metric_definition.* events: analytics-service, ai-agent-service.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS reports.metric_definitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  -- Stable machine key, e.g. crm.lead_to_agreement_cycle_days
  metric_key          VARCHAR(96) NOT NULL,
  display_name        VARCHAR(200) NOT NULL,
  description         TEXT,
  -- Owning module, same convention as reports.kpis.module
  module              VARCHAR(64) NOT NULL,
  -- days | percent | count | bps | currency_minor | ...
  unit                VARCHAR(32) NOT NULL,
  aggregation         VARCHAR(24) NOT NULL,
  -- Logical source identifiers. NOT SQL. Never interpolated into a query.
  numerator_source    VARCHAR(200) NOT NULL,
  denominator_source  VARCHAR(200),
  -- JSON array of allowed slice dimension names, e.g. ["region","channel"]
  dimensions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  period              VARCHAR(24) NOT NULL,
  target_value        NUMERIC,
  higher_is_better    BOOLEAN NOT NULL DEFAULT true,
  -- canonical = platform-standard definition, tenant = tenant-authored
  governance          VARCHAR(16) NOT NULL DEFAULT 'tenant',
  -- Definitions are versioned; a new version is a NEW ROW, never a destructive edit
  version_number      INTEGER NOT NULL DEFAULT 1,
  status              VARCHAR(16) NOT NULL DEFAULT 'draft',
  published_at        TIMESTAMPTZ,
  deprecated_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL,
  updated_by          UUID NOT NULL,
  -- Optimistic lock
  version             INTEGER NOT NULL DEFAULT 1
);

-- ── CHECK constraints ───────────────────────────────────────────────────────
-- Written as DROP + ADD so re-running the migration converges on the same state.

ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_status;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_status
  CHECK (status IN ('draft', 'published', 'deprecated'));

ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_aggregation;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_aggregation
  CHECK (aggregation IN ('sum', 'avg', 'min', 'max', 'count', 'count_distinct', 'ratio', 'percent'));

ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_governance;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_governance
  CHECK (governance IN ('canonical', 'tenant'));

ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_period;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_period
  CHECK (period IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'rolling_30d', 'rolling_90d'));

-- ratio/percent MUST carry a denominator; every other aggregation MUST NOT.
-- Mirrors domain.validateDenominatorRule() so the rule cannot be bypassed by a
-- direct SQL write.
ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_denominator;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_denominator
  CHECK (
    (aggregation IN ('ratio', 'percent') AND denominator_source IS NOT NULL)
    OR (aggregation NOT IN ('ratio', 'percent') AND denominator_source IS NULL)
  );

ALTER TABLE reports.metric_definitions
  DROP CONSTRAINT IF EXISTS chk_metric_definitions_version_number;
ALTER TABLE reports.metric_definitions
  ADD CONSTRAINT chk_metric_definitions_version_number
  CHECK (version_number >= 1);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- A metric key may exist once per version per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_definitions_key_version
  ON reports.metric_definitions (tenant_id, metric_key, version_number);

CREATE INDEX IF NOT EXISTS idx_metric_definitions_tenant_status
  ON reports.metric_definitions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_metric_definitions_tenant_module
  ON reports.metric_definitions (tenant_id, module);

-- Serves GET /v1/reports/metrics/by-key/:metricKey (resolve published version).
CREATE INDEX IF NOT EXISTS idx_metric_definitions_published_key
  ON reports.metric_definitions (metric_key, version_number DESC)
  WHERE status = 'published';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same form as the other tables in this service (current_tenant_id(), migration
-- 0005/0006/0013), with one deliberate read carve-out: the platform tenant
-- (nil uuid) owns the canonical journey definitions seeded by 0018 and every
-- tenant must be able to READ them. WITH CHECK stays strict, so no tenant can
-- insert or update a platform-owned row — the override path is a tenant-owned
-- copy via POST /v1/reports/metrics/:id/versions.
ALTER TABLE reports.metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.metric_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON reports.metric_definitions;
CREATE POLICY tenant_isolation_policy ON reports.metric_definitions
  USING (
    tenant_id = current_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
  )
  WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE reports.metric_definitions IS
  'G4 metric definition catalogue: what a KPI means (source, aggregation, dimensions, period) and who governs it. Sources are opaque logical identifiers, never SQL.';
COMMENT ON COLUMN reports.metric_definitions.numerator_source IS
  'Opaque logical source identifier. NEVER interpolated into SQL.';
COMMENT ON COLUMN reports.metric_definitions.denominator_source IS
  'Opaque logical source identifier. Required for ratio/percent, NULL otherwise.';
