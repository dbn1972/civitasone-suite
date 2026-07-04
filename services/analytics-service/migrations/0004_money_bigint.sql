-- 0004_money_bigint.sql
-- M1: Convert fact_events.amount from NUMERIC(18,2) to BIGINT (paise).
-- All monetary values in CivitasOne are stored as bigint minor units.
-- Coerce existing values: multiply by 100 to convert from rupees to paise.
-- Additive + idempotent.

-- Step 1: Add a temporary column for the conversion
ALTER TABLE analytics.fact_events
  ADD COLUMN IF NOT EXISTS amount_bigint BIGINT;

-- Step 2: Backfill (multiply by 100 to convert from "decimal rupees" to paise)
UPDATE analytics.fact_events
  SET amount_bigint = (amount * 100)::bigint
  WHERE amount_bigint IS NULL;

-- Step 3: Drop old column and rename
ALTER TABLE analytics.fact_events DROP COLUMN IF EXISTS amount;
ALTER TABLE analytics.fact_events RENAME COLUMN amount_bigint TO amount;
ALTER TABLE analytics.fact_events ALTER COLUMN amount SET NOT NULL;
ALTER TABLE analytics.fact_events ALTER COLUMN amount SET DEFAULT 0;
