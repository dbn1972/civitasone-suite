-- 0168_hrms_suspension_subsistence_review.sql
--
-- FR 53 subsistence-allowance review order (payroll pays SUSPENDED employees
-- a subsistence allowance instead of full salary; see payroll-service
-- subsistence.ts).
--
-- FR 53(1)(ii)(a): for the first 3 months of suspension the subsistence
-- allowance (SA) is the leave salary on half-pay (50% of basic) plus DA on it.
-- After 3 months the competent authority REVIEWS it and may increase it by up
-- to 50% of the first-3-months amount (75% of basic) or decrease it by up to
-- 50% (25% of basic). Until this migration there was nowhere to record that
-- review order: disciplinary.hrms_suspensions.subsistence_pct is the single
-- percentage captured when the suspension is created.
--
-- Additive + idempotent only. All new columns are NULLable with no default:
-- an existing suspension has never been reviewed, so NULL is the honest value
-- ("no review order recorded" -> payroll stays at the initial rate and raises
-- a "review order due" flag). Tenant scoping is inherited from the table's
-- existing tenant_id + RLS policy; no new table.
--
-- Migration number: 0166/0167 are reserved by the pay-profiles work, so this
-- takes 0168.
--
-- Rollback:
--   ALTER TABLE disciplinary.hrms_suspensions DROP CONSTRAINT IF EXISTS hrms_susp_revised_pct_range;
--   ALTER TABLE disciplinary.hrms_suspensions
--     DROP COLUMN IF EXISTS revised_subsistence_pct, DROP COLUMN IF EXISTS revised_effective_from,
--     DROP COLUMN IF EXISTS review_order_ref, DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS reviewed_by;

SET lock_timeout = '5s';

ALTER TABLE disciplinary.hrms_suspensions
  ADD COLUMN IF NOT EXISTS revised_subsistence_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS revised_effective_from  date,
  ADD COLUMN IF NOT EXISTS review_order_ref        text,
  ADD COLUMN IF NOT EXISTS reviewed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by             uuid;

-- Range backstop behind the route's Zod validation. Deliberately the full
-- 0..100 band, not FR 53's 25..75: the FR 53 band is a payroll-side,
-- tenant-configurable rule (payroll flags an out-of-band order rather than
-- applying it), and HR must still be able to RECORD whatever the competent
-- authority actually ordered.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hrms_susp_revised_pct_range'
       AND conrelid = 'disciplinary.hrms_suspensions'::regclass
  ) THEN
    ALTER TABLE disciplinary.hrms_suspensions
      ADD CONSTRAINT hrms_susp_revised_pct_range
      CHECK (revised_subsistence_pct IS NULL OR (revised_subsistence_pct >= 0 AND revised_subsistence_pct <= 100));
  END IF;
END $$;
