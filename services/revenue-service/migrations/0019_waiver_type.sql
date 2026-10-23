-- revenue-service migration 0019 - persist the waiver component type
-- Applied AFTER 0018_trade_licenses_money_bigint.sql
-- Rollback:
--   ALTER TABLE revenue.waivers DROP CONSTRAINT IF EXISTS chk_waivers_waiver_type;
--   ALTER TABLE revenue.waivers DROP COLUMN IF EXISTS waiver_type;
--
-- POST /v1/revenue/waivers accepts waiverType (penalty | interest | both) and
-- the create consumer caps the amount by that component, but the value was
-- never stored, so the decide screen / audit trail could not say what the
-- waiver forgave. Additive; existing rows are backfilled to 'both' (the
-- historical default and the most permissive cap they were validated against).
-- Existing table grants cover the new column.

SET lock_timeout = '5s';

ALTER TABLE revenue.waivers
  ADD COLUMN IF NOT EXISTS waiver_type varchar(16) NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_waivers_waiver_type'
  ) THEN
    ALTER TABLE revenue.waivers
      ADD CONSTRAINT chk_waivers_waiver_type CHECK (waiver_type IN ('penalty', 'interest', 'both'));
  END IF;
END $$;
