-- revenue-service migration 0018 — trade_licenses money columns text -> bigint
-- Applied AFTER 0017_adjustment_decision_reason.sql
-- Rollback:
--   ALTER TABLE revenue.trade_licenses DROP CONSTRAINT IF EXISTS chk_trade_licenses_fee_minor_nonneg;
--   ALTER TABLE revenue.trade_licenses DROP CONSTRAINT IF EXISTS chk_trade_licenses_fee_paid_minor_nonneg;
--   ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_minor      TYPE text USING fee_minor::text;
--   ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_paid_minor TYPE text USING fee_paid_minor::text;
--   ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_minor      SET DEFAULT '0';
--   ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_paid_minor SET DEFAULT '0';
--
-- GAP2-REVENUE-TRADE-LICENSES-10 / GAP2-PLATFORM-REVENUE-MONEY-01:
-- revenue.trade_licenses.fee_minor and .fee_paid_minor are the only money
-- (paise / minor-unit) columns in this service stored as `text` (migration
-- 0005). CLAUDE.md §11 requires all money to be `bigint` minor units: as `text`
-- the DB cannot enforce numeric/non-negative values, cannot aggregate/sort
-- numerically, and the trade-license consumer's `BigInt(feeMinor)` throws a
-- non-retryable error on any non-numeric string ever written. This migration
-- converts both columns to `bigint` and adds a `>= 0` CHECK. The default is
-- changed from the text literal '0' to the integer 0 to match.
--
-- Data safety: all existing values are integer strings produced by the service
-- (String(bigint)), so `USING fee_minor::bigint` is a clean, lossless cast.
-- The two statements are each wrapped in a guard so a re-run (where the column
-- is already bigint) is a no-op rather than an error — additive + idempotent.
--
-- NOTE: revenue.waivers.amount_minor was already `bigint` in migration 0005
-- (the GAP2-PLATFORM-REVENUE-MONEY-01 claim that it is `text` is REFUTED against
-- this DB); only the drizzle model drifted and is corrected in schema.ts. No DB
-- change is needed for it here.

SET lock_timeout = '5s';

-- ── fee_minor: text -> bigint ───────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'revenue' AND table_name = 'trade_licenses' AND column_name = 'fee_minor') = 'text'
  THEN
    ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_minor DROP DEFAULT;
    ALTER TABLE revenue.trade_licenses
      ALTER COLUMN fee_minor TYPE bigint USING fee_minor::bigint;
    ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_minor SET DEFAULT 0;
  END IF;
END $$;

-- ── fee_paid_minor: text -> bigint ──────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'revenue' AND table_name = 'trade_licenses' AND column_name = 'fee_paid_minor') = 'text'
  THEN
    ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_paid_minor DROP DEFAULT;
    ALTER TABLE revenue.trade_licenses
      ALTER COLUMN fee_paid_minor TYPE bigint USING fee_paid_minor::bigint;
    ALTER TABLE revenue.trade_licenses ALTER COLUMN fee_paid_minor SET DEFAULT 0;
  END IF;
END $$;

-- ── non-negative CHECK constraints (idempotent) ─────────────────────────────
DO $$
BEGIN
  ALTER TABLE revenue.trade_licenses
    ADD CONSTRAINT chk_trade_licenses_fee_minor_nonneg CHECK (fee_minor >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE revenue.trade_licenses
    ADD CONSTRAINT chk_trade_licenses_fee_paid_minor_nonneg CHECK (fee_paid_minor >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
