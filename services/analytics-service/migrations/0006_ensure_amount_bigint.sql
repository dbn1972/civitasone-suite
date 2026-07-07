-- 0006_ensure_amount_bigint.sql
-- Purpose: Ensure analytics.fact_events.amount column is BIGINT (paise).
--          All monetary values in CivitasOne are stored as bigint minor units.
--          This migration is idempotent — it only alters the column if it is
--          not already of type bigint.
--
-- Rollback steps:
--   ALTER TABLE analytics.fact_events ALTER COLUMN amount TYPE numeric(18,2);
--   -- Note: reverting loses paise precision; only do so if data was not yet
--   -- stored as paise (i.e., immediately after a failed deploy).
--
-- Affected services: analytics-service (fact ingestion consumer, query builder)

SET lock_timeout = '5s';

DO $$
BEGIN
  -- Only alter if the column exists and is NOT already bigint (int8)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'analytics'
      AND table_name = 'fact_events'
      AND column_name = 'amount'
      AND data_type <> 'bigint'
  ) THEN
    ALTER TABLE analytics.fact_events
      ALTER COLUMN amount TYPE bigint USING amount::bigint;

    ALTER TABLE analytics.fact_events
      ALTER COLUMN amount SET NOT NULL;

    ALTER TABLE analytics.fact_events
      ALTER COLUMN amount SET DEFAULT 0;
  END IF;
END $$;
