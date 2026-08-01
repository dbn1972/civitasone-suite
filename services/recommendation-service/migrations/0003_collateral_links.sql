-- Purpose: CR-AI-02 — link a served recommendation to the sales collateral a rep should
--          use when acting on it (document, video, brochure, case study, pricing sheet).
-- Rollback: DROP TABLE IF EXISTS recommendation.collateral_links; (destructive — requires approval)
-- Affected services: recommendation-service only (collateral_ref points at knowledge/catalogue
--                    assets by reference; no cross-schema FK by design — module isolation L2)
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS recommendation;

CREATE TABLE IF NOT EXISTS recommendation.collateral_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  collateral_type   varchar(24) NOT NULL,
  -- Opaque reference into the owning service (document id, S3 key, catalogue sku…).
  -- Deliberately not a FK: collateral lives in another service's database.
  collateral_ref    varchar(512) NOT NULL,
  title             varchar(256) NOT NULL,
  -- Presentation order within a recommendation. Lower shows first.
  ordinal           int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           int NOT NULL DEFAULT 1,
  CONSTRAINT chk_collateral_links_type
    CHECK (collateral_type IN ('document', 'video', 'brochure', 'case_study', 'pricing_sheet'))
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_links_tenant_id
  ON recommendation.collateral_links (tenant_id);
-- Serves GET /v1/recommendations/:id/collateral (ordered by ordinal).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_collateral_links_tenant_rec_ordinal
  ON recommendation.collateral_links (tenant_id, recommendation_id, ordinal);

-- RLS
ALTER TABLE recommendation.collateral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation.collateral_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collateral_links_tenant_isolation ON recommendation.collateral_links;
CREATE POLICY collateral_links_tenant_isolation ON recommendation.collateral_links
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT USAGE ON SCHEMA recommendation TO recommendation_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.collateral_links TO recommendation_svc;
  END IF;
END $$;
