-- 0170_hrms_job_opening_structured_pay.sql
--
-- GAP-RECRUITMENT-NEW-02: structured pay on a job opening. pay_range stays the
-- human-readable display string; these optional columns carry the 7th-CPC pay
-- level and the min/max basic pay in MINOR UNITS (paise) so the offer/hire
-- paths can be driven from the advertised range instead of re-typing it.
-- Nullable + additive + idempotent: existing rows are untouched.

SET lock_timeout = '5s';

ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS pay_level     varchar(16),
  ADD COLUMN IF NOT EXISTS pay_min_minor bigint,
  ADD COLUMN IF NOT EXISTS pay_max_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hrms_job_openings_pay_range_order_chk'
  ) THEN
    ALTER TABLE recruitment.hrms_job_openings
      ADD CONSTRAINT hrms_job_openings_pay_range_order_chk
      CHECK (
        (pay_min_minor IS NULL OR pay_min_minor >= 0)
        AND (pay_max_minor IS NULL OR pay_max_minor >= 0)
        AND (pay_min_minor IS NULL OR pay_max_minor IS NULL OR pay_min_minor <= pay_max_minor)
      );
  END IF;
END $$;
