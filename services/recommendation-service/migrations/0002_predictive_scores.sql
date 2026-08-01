-- Purpose: CR-AI-01 — predictive model scores (LTV, renewal, fraud, churn) written by
--          ml-service and read by CRM/NBA surfaces.
-- Rollback: DROP TABLE IF EXISTS recommendation.predictive_scores; (destructive — requires approval)
-- Affected services: recommendation-service (owner), ml-service (writer via HTTP PUT)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recommendation;

-- ────────────────────────────────────────────────────────────────────────────
-- Predictive scores — one row per (subject, model_type) per tenant.
--
-- score is numeric(12,4) and NOT a float: LTV values are money-like magnitudes
-- and the API contract returns them as strings so no precision is lost on the
-- JSON boundary (see predictive/repo.ts toView).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation.predictive_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- What the score is about. Kept as varchar + CHECK rather than an enum type so
  -- new subject kinds are an additive migration, not an ALTER TYPE.
  subject_type  varchar(24) NOT NULL,
  subject_id    uuid NOT NULL,
  model_type    varchar(24) NOT NULL,
  score         numeric(12,4) NOT NULL,
  -- Model self-reported confidence in the 0.0000 – 1.0000 range.
  confidence    numeric(5,4),
  model_version varchar(64),
  -- Feature vector actually used, retained so a score can be explained later.
  features      jsonb NOT NULL DEFAULT '{}',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1,
  CONSTRAINT chk_predictive_scores_subject_type
    CHECK (subject_type IN ('profile', 'account', 'deal')),
  CONSTRAINT chk_predictive_scores_model_type
    CHECK (model_type IN ('ltv', 'renewal', 'fraud', 'churn')),
  -- Upsert target for PUT /v1/recommendations/predictive/... — one live score
  -- per model per subject; history lives in the analytics warehouse, not here.
  CONSTRAINT uq_predictive_scores_subject_model
    UNIQUE (tenant_id, subject_type, subject_id, model_type)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictive_scores_tenant_id
  ON recommendation.predictive_scores (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictive_scores_tenant_subject
  ON recommendation.predictive_scores (tenant_id, subject_type, subject_id);
-- Serves GET /v1/recommendations/predictive?modelType=&minScore= (ranked list).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictive_scores_tenant_model_score
  ON recommendation.predictive_scores (tenant_id, model_type, score DESC);

-- RLS
ALTER TABLE recommendation.predictive_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.predictive_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS predictive_scores_tenant_isolation ON recommendation.predictive_scores;
CREATE POLICY predictive_scores_tenant_isolation ON recommendation.predictive_scores
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Guarded grants: the recommendation_svc LOGIN role is provisioned by
-- infra/db/bootstrap/*, never by a migration (see 0001 for the rationale).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.predictive_scores TO recommendation_svc;
  END IF;
END $$;
