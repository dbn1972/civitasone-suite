-- 0163_max_deduction_share.sql
--
-- UAT T-PERIOD D-02b (2026-11-04, CRITICAL): the March 2027 s.192 true-up
-- deducted TDS Rs 2,70,847 from a gross of Rs 2,31,428 (net Rs 0) and the run
-- was approved and paid. TDS is now capped so that a slip deductions stay
-- within a configured share of the month gross (and within gross less the
-- protected-net floor); the part not deducted is reported on the run
-- (TDS_CAPPED_BY_NET_PAY) and recovered by the true-up of later months.
--
-- payroll.payroll_settings.max_deduction_share_bps: basis points of the month
-- gross, 1000..10000. Default 7500 (75%): the Payment of Wages Act s.7(3)
-- ceiling on total deductions (a tenant may set 5000 where co-operative /
-- society recoveries are not deducted). A tenant with no settings row resolves
-- to the same default in code (DEFAULT_MAX_DEDUCTION_SHARE_BPS).
--
-- Additive and idempotent; no existing column, constraint, policy or row is
-- changed. Old code ignores the column.
--
-- Rollback:
--   ALTER TABLE payroll.payroll_settings DROP CONSTRAINT IF EXISTS payroll_settings_max_deduction_share_chk;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS max_deduction_share_bps;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS max_deduction_share_bps INTEGER NOT NULL DEFAULT 7500;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_settings
    ADD CONSTRAINT payroll_settings_max_deduction_share_chk
    CHECK (max_deduction_share_bps BETWEEN 1000 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
