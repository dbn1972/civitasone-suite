-- 0160_arrears_due_minus_drawn.sql
--
-- T-STAT (statutory audit 2026-11-03) F03 / M-NPS / M-ZERO / arrears review /
-- pensioner s.192. ADDITIVE ONLY: no index, column, constraint value or row
-- that the code before this release uses is removed or changed, so this
-- migration is safe to apply before, together with, or slightly before the
-- new code (old code keeps working on it unchanged). The new code needs it
-- applied first (standard: migrations run before the service restarts).
--
-- payroll.payroll_arrears
--   source = 'revision_dmd' marks the new "due minus drawn" settlement rows
--   (payroll/consumer.ts generateRetroArrears). Old code writes and dedupes
--   source = 'revision' rows on ux_payroll_arrears_revision_period, which is
--   KEPT as is: the new rows are outside its WHERE clause, so a month can be
--   settled again for an increment (a second DA revision) without touching it.
--   settled_in_period  the run month whose run raised the row; with the
--                      component and month it is the dedupe key of the new
--                      rows (ux_payroll_arrears_dmd_settled). Existing rows: .
--   pension_base_minor the Basic + DA part of the arrear (same sign as
--                      difference_minor) the NPS 10% / 14% fall on. NULL on
--                      rows written before this migration (not reconstructed).
--   ix_payroll_arrears_tenant_emp_period: the per-run batched read of every
--                      arrear raised for the run employees (no usable index:
--                      the two existing ones are partial).
-- payroll.payroll_slips.status  + 'excluded': a Rs 0-basic slip explicitly
--   excluded on approval (never paid, in no bank file).
-- payroll.payroll_settings.arrears_review_threshold_bps: arrears on a slip above
--   this share of the regular monthly gross (bps; default 10000 = one month)
--   need an explicit acknowledgement to approve the run.
-- payroll.payroll_pensioners.pension_commencement_date: optional; with it the
--   pensioner s.192 estimate starts from the month pension began (a mid-year
--   retiree), without it the whole FY is assumed (as before).
--
-- FORCE ROW LEVEL SECURITY on every table is unchanged. Idempotent.
-- Rollback (only after the code is rolled back):
--   DROP INDEX IF EXISTS payroll.ux_payroll_arrears_dmd_settled;
--   DROP INDEX IF EXISTS payroll.ix_payroll_arrears_tenant_emp_period;
--   ALTER TABLE payroll.payroll_arrears DROP COLUMN IF EXISTS pension_base_minor, DROP COLUMN IF EXISTS settled_in_period;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS arrears_review_threshold_bps;
--   ALTER TABLE payroll.payroll_pensioners DROP COLUMN IF EXISTS pension_commencement_date;
--   (slips: re-add payroll_slips_status_check without 'excluded' once no slip uses it)

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS settled_in_period VARCHAR(7) NOT NULL DEFAULT '';

ALTER TABLE payroll.payroll_arrears
  ADD COLUMN IF NOT EXISTS pension_base_minor BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_arrears_dmd_settled
  ON payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, settled_in_period)
  WHERE source = 'revision_dmd';

CREATE INDEX IF NOT EXISTS ix_payroll_arrears_tenant_emp_period
  ON payroll.payroll_arrears (tenant_id, employee_id, from_period);

ALTER TABLE payroll.payroll_slips
  DROP CONSTRAINT IF EXISTS payroll_slips_status_check;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_slips
    ADD CONSTRAINT payroll_slips_status_check
    CHECK (status IN ('computed', 'approved', 'paid', 'held', 'exception', 'excluded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE payroll.payroll_slips
  VALIDATE CONSTRAINT payroll_slips_status_check;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS arrears_review_threshold_bps INTEGER NOT NULL DEFAULT 10000;
DO $$ BEGIN
  ALTER TABLE payroll.payroll_settings
    ADD CONSTRAINT payroll_settings_arrears_review_threshold_chk CHECK (arrears_review_threshold_bps >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.payroll_pensioners
  ADD COLUMN IF NOT EXISTS pension_commencement_date DATE;
