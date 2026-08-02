-- Purpose: XS-003 (cross-sell measurement — attach rate and uplift) — the two tables the
--          metrics need, plus the attribution link back to the recommendation that
--          produced an outcome.
--
--            cross_sell_exposures    — the DENOMINATOR. One row per subject per campaign
--                                      recording its cohort. A control/holdout subject
--                                      appears here and is served nothing, which is what
--                                      makes it a control; outcomes alone can never supply
--                                      this number.
--            cross_sell_attributions — the NUMERATOR. One row per outcome, carrying the
--                                      recommendation credited with it. recommendation_id
--                                      is NULLABLE because a control subject converts
--                                      without ever having been recommended anything, and
--                                      that conversion is the baseline uplift is measured
--                                      against.
--
--          MONEY: attributed_amount_minor is bigint MINOR UNITS (paise/cents) and is
--          serialised as a STRING in JSON. Never numeric, never float — above 2^53 a JSON
--          number silently loses paise.
--
--          RATIOS: attach rate and uplift are NOT stored. They are derived on read from
--          these counts and returned as integer BASIS POINTS, because every such ratio is
--          a quotient of two integer counts and therefore has an exact integer form:
--          round(numerator * 10000 / denominator). Storing a rounded rate would make the
--          numbers un-recomputable when the window changes.
--
--          campaign_key, outcome_type and cohort values are tenant-defined strings, so the
--          platform never needs to know what a deployment sells.
--
-- Rollback: SET lock_timeout = '5s';
--           DROP TABLE IF EXISTS recommendation.cross_sell_attributions;
--           DROP TABLE IF EXISTS recommendation.cross_sell_exposures;
--           (destructive — requires tech-lead approval per the migration rules)
--
-- Affected services: recommendation-service writes and reads these. analytics-service
--                    consumes the recommendation.outcome.attributed event to build the
--                    dashboards; it does NOT read these tables (no cross-service SQL).
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recommendation;

CREATE TABLE IF NOT EXISTS recommendation.cross_sell_exposures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- Tenant-defined experiment identifier.
  campaign_key  varchar(64) NOT NULL,
  subject_id    uuid NOT NULL,
  -- treatment | control
  cohort        varchar(16) NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1,
  CONSTRAINT ck_cross_sell_exposures_cohort CHECK (cohort IN ('treatment', 'control')),
  -- A subject belongs to exactly one cohort per campaign. Without this, a re-assignment
  -- would double-count the denominator and silently depress every measured attach rate.
  CONSTRAINT uq_cross_sell_exposures_subject UNIQUE (tenant_id, campaign_key, subject_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_exposures_cohort
  ON recommendation.cross_sell_exposures (tenant_id, campaign_key, cohort);

CREATE TABLE IF NOT EXISTS recommendation.cross_sell_attributions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  campaign_key             varchar(64) NOT NULL,
  subject_id               uuid NOT NULL,
  -- NULL for a control-cohort conversion — see the header note.
  recommendation_id        uuid,
  -- Tenant-defined outcome kind.
  outcome_type             varchar(48) NOT NULL,
  -- External reference of the outcome (order no, policy no). Business key.
  outcome_ref              varchar(128) NOT NULL,
  product_id               uuid,
  -- MONEY — bigint minor units. Serialised as a STRING in JSON.
  attributed_amount_minor  bigint NOT NULL DEFAULT 0,
  currency                 varchar(3) NOT NULL,
  -- treatment | control, denormalised from the exposure so metric queries need no join.
  cohort                   varchar(16) NOT NULL,
  -- last_touch | first_touch — which rule granted the credit.
  attribution_model        varchar(32) NOT NULL,
  occurred_at              timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  int NOT NULL DEFAULT 1,
  CONSTRAINT ck_cross_sell_attributions_cohort CHECK (cohort IN ('treatment', 'control')),
  CONSTRAINT ck_cross_sell_attributions_model
    CHECK (attribution_model IN ('last_touch', 'first_touch')),
  CONSTRAINT ck_cross_sell_attributions_amount CHECK (attributed_amount_minor >= 0),
  -- A control subject must not carry a recommendation: if it did, it was served, and it
  -- is no longer a holdout. Enforced in the database because a corrupted holdout
  -- invalidates every uplift number computed from the campaign.
  CONSTRAINT ck_cross_sell_attributions_control_unserved
    CHECK (cohort <> 'control' OR recommendation_id IS NULL),
  -- One attribution per outcome per campaign. This is what makes a redelivered
  -- record-attribution command safe: the second insert violates the constraint rather
  -- than inflating the numerator.
  CONSTRAINT uq_cross_sell_attributions_outcome UNIQUE (tenant_id, campaign_key, outcome_ref)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_attributions_campaign
  ON recommendation.cross_sell_attributions (tenant_id, campaign_key, cohort);
-- Serves the windowed attach-rate / uplift queries (occurred_at half-open range).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_attributions_occurred
  ON recommendation.cross_sell_attributions (tenant_id, campaign_key, occurred_at DESC);

-- RLS
ALTER TABLE recommendation.cross_sell_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.cross_sell_exposures FORCE ROW LEVEL SECURITY;
ALTER TABLE recommendation.cross_sell_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.cross_sell_attributions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_sell_exposures_tenant_isolation ON recommendation.cross_sell_exposures;
CREATE POLICY cross_sell_exposures_tenant_isolation ON recommendation.cross_sell_exposures
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS cross_sell_attributions_tenant_isolation ON recommendation.cross_sell_attributions;
CREATE POLICY cross_sell_attributions_tenant_isolation ON recommendation.cross_sell_attributions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.cross_sell_exposures TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.cross_sell_attributions TO recommendation_svc;
  END IF;
END $$;
