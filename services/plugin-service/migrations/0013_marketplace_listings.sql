-- Migration: 0013_marketplace_listings.sql
-- Purpose: Creates the plugin.marketplace_listings table. Declared in
--          src/modules/marketplace/schema.ts but no migration ever created
--          it — GET /v1/plugins/marketplace and GET /v1/plugins/marketplace/:id
--          throw `relation "plugin.marketplace_listings" does not exist`
--          (500 INTERNAL) on every request, on every environment. Found live
--          while re-verifying the plugin-service fixes in PRs #797/#798.
--
-- No tenant_id: this is an intentionally GLOBAL catalogue (available plugins
-- any tenant can browse/install), not per-tenant data — repo.ts's
-- listListings()/findListing() never filter by tenant, matching that
-- design. No RLS policy, consistent with the other tenant-agnostic schema
-- in this service (none currently) and with how this table is actually
-- queried.
-- Rollback: DROP TABLE IF EXISTS plugin.marketplace_listings;
-- Affected services: plugin-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS plugin.marketplace_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(128) NOT NULL,
  version     VARCHAR(32) NOT NULL,
  publisher   VARCHAR(128) NOT NULL,
  description TEXT,
  category    VARCHAR(64),
  rating      NUMERIC(2, 1),
  installs    INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_active ON plugin.marketplace_listings (is_active);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_category ON plugin.marketplace_listings (category);

-- Grants: migrations run as civitas_admin (scripts/dev/migrate-all.mjs), so
-- this table is owned by civitas_admin, not plugin_svc — the role
-- plugin-service actually connects as. Granting explicitly here (rather
-- than depending solely on scripts/dev/grant-all.mjs, which only backfills
-- grants after every service in the ~45-service fleet migrates with zero
-- errors) makes this migration self-sufficient — see the sibling
-- 0003a/0003b files' commit history for the outage this exact gap caused
-- on hooks.plugin_hooks/registry.plugins.
GRANT SELECT, INSERT, UPDATE, DELETE ON plugin.marketplace_listings TO plugin_svc;
