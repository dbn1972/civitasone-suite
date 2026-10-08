-- 0049: Prevent overlapping effective-dated licence-fee rates for the same
-- (tenant_id, quarter_type, pay_level).
--
-- GAP2-ESTAB-QUARTERS-LICENCE-FEE-01: the rate table is effective-dated but had
-- no constraint, so a tenant could hold several rows matching one
-- type+pay-level with overlapping [effective_from, effective_to] ranges. The
-- occupy/vacate consumers now pick the row applicable on the business date via
-- findApplicableRate(); this constraint additionally guarantees at most ONE
-- applicable row for any given date, so the selection is unambiguous.
--
-- Uses a GiST exclusion constraint over a daterange built from
-- [effective_from, COALESCE(effective_to, 'infinity')]. effective_to is treated
-- as an INCLUSIVE last-day, so the half-open range upper bound is the day after.
--
-- Additive + idempotent (catalog check guards the constraint; IF NOT EXISTS on
-- the index). Requires btree_gist for equality on the uuid/varchar columns.
--
-- Rollback:
--   ALTER TABLE quarters.estab_licence_fee_rates
--     DROP CONSTRAINT IF EXISTS excl_licence_fee_no_overlap;
--   DROP INDEX IF EXISTS quarters.idx_licence_fee_daterange;

SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'excl_licence_fee_no_overlap'
      AND conrelid = 'quarters.estab_licence_fee_rates'::regclass
  ) THEN
    ALTER TABLE quarters.estab_licence_fee_rates
      ADD CONSTRAINT excl_licence_fee_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        quarter_type WITH =,
        pay_level WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
  END IF;
END $$;

-- Supporting GiST index for the daterange lookups the exclusion relies on.
CREATE INDEX IF NOT EXISTS idx_licence_fee_daterange
  ON quarters.estab_licence_fee_rates
  USING gist (tenant_id, quarter_type, pay_level,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]'));
