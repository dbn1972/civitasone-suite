-- Purpose: CDP-009 — predictive scores attached to a golden profile (churn, propensity,
--          CLV band, …). Written by ml-service through the CDP score API.
-- Rollback: DROP TABLE IF EXISTS cdp.profile_scores; (destructive — requires approval)
-- Affected services: cdp-service (owner), ml-service (producer via HTTP)
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cdp.profile_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  profile_id    uuid NOT NULL REFERENCES cdp.profiles(id),
  score_type    varchar(64) NOT NULL,
  -- numeric, not double precision: a model score is compared and thresholded, so
  -- binary float drift across a write/read round-trip is not acceptable. The driver
  -- surfaces numeric as a string and the API keeps it a string for that reason.
  score         numeric(6,4) NOT NULL,
  model_version varchar(64) NOT NULL DEFAULT 'unknown',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  version       int NOT NULL DEFAULT 1
);

-- Latest score per (profile, type): the score API upserts against this key.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_profile_scores_tenant_profile_type
  ON cdp.profile_scores (tenant_id, profile_id, score_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profile_scores_profile
  ON cdp.profile_scores (tenant_id, profile_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profile_scores_type
  ON cdp.profile_scores (tenant_id, score_type, computed_at DESC);

ALTER TABLE cdp.profile_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdp.profile_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_scores_tenant_isolation ON cdp.profile_scores;
CREATE POLICY profile_scores_tenant_isolation ON cdp.profile_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cdp_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cdp.profile_scores TO cdp_svc;
  END IF;
END $g$;
