-- Purpose: IN-007, FS-006, MP-011 — ONE generic, tenant-configurable trigger-rule table
--          that expresses all three requirements as configuration rather than code:
--
--            holding_based  — the subject already holds something in source_category, so
--                             offer target_category. Covers cross-selling a protection /
--                             insurance category off a savings-type holding base (IN-007).
--            life_event     — an event of event_code happened, or is scheduled to, near
--                             the evaluation instant. Covers maturity-approaching,
--                             address change and age thresholds (FS-006).
--            volume_pattern — aggregate shipping-lane / consignment behaviour crossed a
--                             configured threshold. Covers premium-product leads detected
--                             from lane patterns (MP-011).
--
--          source_category / target_category / event_code are OPAQUE tenant-defined
--          strings, deliberately not enums and deliberately not product-specific: the
--          platform must not encode what any one deployment calls its product families.
--          Mapping a real catalogue onto these categories belongs in that deployment's
--          adapter, not in this service.
--
--          conditions is a jsonb threshold bag; the grammar is documented in
--          src/modules/triggers/schema.ts (TriggerConditions). Monetary thresholds inside
--          it are integer minor-unit STRINGS so a threshold above 2^53 keeps its
--          precision through JSON. weight_bps is BASIS POINTS (a ratio, so an integer,
--          not money and not a float).
--
-- Rollback: SET lock_timeout = '5s';
--           DROP TABLE IF EXISTS recommendation.trigger_rules;
--           (destructive — requires tech-lead approval per the migration rules)
--
-- Affected services: recommendation-service only. New table, no existing table touched.
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recommendation;

CREATE TABLE IF NOT EXISTS recommendation.trigger_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  -- holding_based | life_event | volume_pattern
  rule_type        varchar(32) NOT NULL,
  name             varchar(128) NOT NULL,
  -- Tenant-defined product category the subject must already hold (holding_based).
  source_category  varchar(64),
  -- Tenant-defined product category to recommend when the rule fires.
  target_category  varchar(64) NOT NULL,
  -- Tenant-defined life-event code (life_event).
  event_code       varchar(64),
  -- Threshold bag; see TriggerConditions in src/modules/triggers/schema.ts.
  conditions       jsonb NOT NULL DEFAULT '{}',
  priority         int NOT NULL DEFAULT 0,
  -- Basis points, 0..10000 (= 0%..100%). A ratio, so an exact integer.
  weight_bps       int NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  -- Half-open [effective_from, effective_to): a rule whose window ends exactly at the
  -- evaluation instant is already expired, so consecutive windows tile the timeline.
  effective_from   timestamptz,
  effective_to     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          int NOT NULL DEFAULT 1,
  CONSTRAINT ck_trigger_rules_rule_type
    CHECK (rule_type IN ('holding_based', 'life_event', 'volume_pattern')),
  CONSTRAINT ck_trigger_rules_weight_bps
    CHECK (weight_bps >= 0 AND weight_bps <= 10000),
  CONSTRAINT ck_trigger_rules_effective_range
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from),
  -- holding_based cannot fire without a source category to test, so the database
  -- refuses to store one that would be permanently inert.
  CONSTRAINT ck_trigger_rules_holding_source
    CHECK (rule_type <> 'holding_based' OR source_category IS NOT NULL),
  CONSTRAINT ck_trigger_rules_life_event_code
    CHECK (rule_type <> 'life_event' OR event_code IS NOT NULL),
  -- One rule name per tenant keeps operator-facing configuration legible.
  CONSTRAINT uq_trigger_rules_name UNIQUE (tenant_id, name)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trigger_rules_tenant_type
  ON recommendation.trigger_rules (tenant_id, rule_type);
-- Serves POST /v1/recommendations/trigger-rules/evaluate: active rules inside their
-- effective window, ordered by priority then weight.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trigger_rules_evaluable
  ON recommendation.trigger_rules (tenant_id, active, priority DESC, weight_bps DESC);

-- RLS
ALTER TABLE recommendation.trigger_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.trigger_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trigger_rules_tenant_isolation ON recommendation.trigger_rules;
CREATE POLICY trigger_rules_tenant_isolation ON recommendation.trigger_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.trigger_rules TO recommendation_svc;
  END IF;
END $$;
