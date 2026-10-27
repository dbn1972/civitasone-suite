-- Migration: 0027_infra_asset_link.sql
-- Purpose (GAP-LOCATIONS-INFRASTRUCTURE-06, UAT B4): let an infrastructure asset point at its record in
-- the asset register. The infrastructure API carried no asset-service id, so rows could not link to
-- /assets/:id. asset_id is an OPTIONAL cross-service reference (asset-service owns that table; there is
-- deliberately no foreign key across service databases). NULL = no linked register record.
-- Additive, idempotent, no CONCURRENTLY. Rollback:
--   DROP INDEX IF EXISTS location.idx_infra_assets_asset_id;
--   ALTER TABLE location.infrastructure_assets DROP COLUMN IF EXISTS asset_id;
SET lock_timeout = '5s';

ALTER TABLE location.infrastructure_assets ADD COLUMN IF NOT EXISTS asset_id uuid;
CREATE INDEX IF NOT EXISTS idx_infra_assets_asset_id
  ON location.infrastructure_assets (tenant_id, asset_id) WHERE asset_id IS NOT NULL;
