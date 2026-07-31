-- 0001_add_rates_effective_to.sql
-- Adds `effective_to` column to catalogue.rates for bounded effective-date ranges.
-- Previously a rate was open-ended from its effective_date; this column allows
-- closing a rate period explicitly (inclusive end date). NULL = still current.
--
-- Additive + idempotent. No data backfill required (NULL = open-ended by default).
--
-- Rollback:
--   ALTER TABLE catalogue.rates DROP COLUMN IF EXISTS effective_to;

SET lock_timeout = '5s';

ALTER TABLE catalogue.rates
  ADD COLUMN IF NOT EXISTS effective_to date;

COMMENT ON COLUMN catalogue.rates.effective_to IS 'End of effective period (inclusive). NULL = open-ended / still current.';
