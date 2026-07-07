-- 0007_ensure_price_minor_bigint.sql
-- Purpose: Ensure plans.billing_plans.price_minor column is BIGINT (paise).
--          All monetary values in CivitasOne are stored as bigint minor units.
--          This migration is idempotent — it only alters the column if it is
--          not already of type bigint.
--
-- Rollback steps:
--   ALTER TABLE plans.billing_plans ALTER COLUMN price_minor TYPE integer;
--   -- Note: reverting may truncate values that exceed integer range (>~21 crore).
--   -- Only revert immediately after a failed deploy with no large-value data.
--
-- Affected services: billing-service (plan CRUD, subscription billing, invoicing)

SET lock_timeout = '5s';

DO $$
BEGIN
  -- Only alter if the column exists and is NOT already bigint (int8)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plans'
      AND table_name = 'billing_plans'
      AND column_name = 'price_minor'
      AND data_type <> 'bigint'
  ) THEN
    ALTER TABLE plans.billing_plans
      ALTER COLUMN price_minor TYPE bigint USING price_minor::bigint;

    ALTER TABLE plans.billing_plans
      ALTER COLUMN price_minor SET NOT NULL;

    ALTER TABLE plans.billing_plans
      ALTER COLUMN price_minor SET DEFAULT 0;
  END IF;
END $$;
