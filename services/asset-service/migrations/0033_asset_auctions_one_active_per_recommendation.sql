-- Migration: 0033_asset_auctions_one_active_per_recommendation.sql
-- One approved condemnation recommendation may be auctioned once. Without
-- this, two auctions could be opened on the same recommendation and both
-- completed, posting the sale receipt and the disposal GL journal twice.
-- The condemnation consumer also refuses a second create inside its
-- transaction (assertNoActiveAuction); this index is the database backstop.
-- Idempotent (IF NOT EXISTS). If it ever fails to build, a tenant already has
-- two pending/completed auctions for one recommendation -- resolve those
-- rows first; do not drop the index.
-- Rollback: DROP INDEX IF EXISTS lifecycle.uq_asset_auctions_active_per_recommendation;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_auctions_active_per_recommendation
  ON lifecycle.asset_auctions (recommendation_id)
  WHERE status IN ('pending', 'completed');
