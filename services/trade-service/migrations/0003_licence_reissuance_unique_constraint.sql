-- Purpose: trade_licences has NO unique or FK constraint on application_id
-- at all (confirmed against migrations/0001_initial.sql,
-- 0002_licence_public_directory.sql) -- only a plain, non-unique index
-- (trade_licences_application_idx). The only protection against a licence
-- being issued more than once for the same application was
-- licences/repo.ts's findByApplicationId pre-check in routes.ts's POST
-- /v1/trade/licences handler -- a check-then-insert race with nothing
-- holding a lock in between, exactly the class of gap roadcut-service's
-- migrations/0002_permit_restoration_unique_constraints.sql closed (see
-- #816 there). This migration adds the missing DB-level backstop, as a
-- partial unique index so it agrees with findByApplicationId's app-level
-- check exactly.
--
-- Only 'cancelled' is excluded, not 'expired': this domain model has no
-- renewal flow (unlike advertisement-service's canRenew) that reissues a
-- licence for an already-expired one under the same application --
-- excluding 'expired' here would be speculative, not evidenced by the code.
-- Rollback: DROP INDEX trade.trade_licences_application_active_unique;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS trade_licences_application_active_unique
  ON trade.trade_licences (application_id)
  WHERE status != 'cancelled';
