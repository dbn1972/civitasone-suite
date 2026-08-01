-- Purpose: F.6 (key-account intelligence) — per-account white-space map, risk signals and
--          a ranked opportunity score used by the key-account dashboard.
-- Rollback: DROP TABLE IF EXISTS recommendation.account_intelligence; (destructive — requires approval)
-- Affected services: recommendation-service only
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recommendation;

CREATE TABLE IF NOT EXISTS recommendation.account_intelligence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  account_id        uuid NOT NULL,
  -- Products/categories the account does NOT own yet: [{ productId, label?, estimatedValue? }].
  white_space       jsonb NOT NULL DEFAULT '[]',
  -- Detected risks: [{ code, severity }] where severity is low|medium|high|critical.
  risk_signals      jsonb NOT NULL DEFAULT '[]',
  -- Ranked 0.0000 – 1.0000. Returned as a string by the API so the exact scale survives JSON.
  opportunity_score numeric(6,4) NOT NULL DEFAULT 0,
  last_computed_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           int NOT NULL DEFAULT 1,
  -- One live intelligence record per account; recompute upserts in place.
  CONSTRAINT uq_account_intelligence_account UNIQUE (tenant_id, account_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_intelligence_tenant_id
  ON recommendation.account_intelligence (tenant_id);
-- Serves GET /v1/recommendations/accounts/intelligence?minOpportunityScore= (ranked).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_intelligence_tenant_score
  ON recommendation.account_intelligence (tenant_id, opportunity_score DESC);

-- RLS
ALTER TABLE recommendation.account_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.account_intelligence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_intelligence_tenant_isolation ON recommendation.account_intelligence;
CREATE POLICY account_intelligence_tenant_isolation ON recommendation.account_intelligence
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.account_intelligence TO recommendation_svc;
  END IF;
END $$;
