-- Migration: 0032_asset_status_condemned.sql
-- The condemnation consumer marks an asset "condemned" when a committee
-- "condemn" recommendation is approved (condemnation/consumer.ts), and the
-- web/types model that status (AssetSummary.status). But 0011's
-- asset_assets_status_check never allowed it, so every such approval failed
-- in the consumer with a check-constraint violation and rolled back: the
-- recommendation stayed "pending" forever and the auction step was
-- unreachable. Found while closing GAP-ASSETS-CONDEMNATION-01..03.
-- Idempotent (DROP IF EXISTS + re-add). Widening only: every row valid under
-- the old list is valid under the new one, so VALIDATE cannot fail.
-- Rollback: re-run the 0011 definition (only after no row holds 'condemned').

SET lock_timeout = '5s';

ALTER TABLE register.asset_assets DROP CONSTRAINT IF EXISTS asset_assets_status_check;
ALTER TABLE register.asset_assets
  ADD CONSTRAINT asset_assets_status_check
  CHECK (status IN ('active', 'disposed', 'transferred', 'lost', 'under_maintenance', 'scrapped', 'written_off', 'condemned'))
  NOT VALID;
ALTER TABLE register.asset_assets VALIDATE CONSTRAINT asset_assets_status_check;
