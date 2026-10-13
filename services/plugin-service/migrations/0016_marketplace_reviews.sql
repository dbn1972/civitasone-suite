-- Migration: 0016_marketplace_reviews.sql
-- Purpose: Gives POST /v1/plugins/marketplace/:id/review (plugin.marketplace.review) a
--          consumer to write to. Reviews are per tenant (FORCE RLS), one per reviewer per
--          listing. The global listing keeps a running rating_sum / rating_count so its
--          public rating can be recomputed without a cross-tenant read.
-- Rollback: DROP TABLE IF EXISTS plugin.marketplace_reviews;
--           ALTER TABLE plugin.marketplace_listings DROP COLUMN IF EXISTS rating_sum, DROP COLUMN IF EXISTS rating_count;
-- Affected services: plugin-service

SET lock_timeout = '5s';

ALTER TABLE plugin.marketplace_listings ADD COLUMN IF NOT EXISTS rating_sum INT NOT NULL DEFAULT 0;
ALTER TABLE plugin.marketplace_listings ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS plugin.marketplace_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  listing_id  UUID NOT NULL REFERENCES plugin.marketplace_listings (id),
  reviewer_id UUID NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
  message_id  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL,
  updated_by  UUID NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_marketplace_reviews_tenant_listing_reviewer UNIQUE (tenant_id, listing_id, reviewer_id)
);

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE plugin.marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin.marketplace_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON plugin.marketplace_reviews;
CREATE POLICY tenant_isolation
  ON plugin.marketplace_reviews
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_tenant_listing
  ON plugin.marketplace_reviews (tenant_id, listing_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON plugin.marketplace_reviews TO plugin_svc;
