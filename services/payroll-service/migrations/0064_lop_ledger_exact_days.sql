-- 0064_lop_ledger_exact_days.sql
--
-- GAP-HR-LEAVE-APPLY-05: half-day leave means LOP can be fractional (0.5 day
-- of unpaid leave, 0.25 for a half day of half-pay leave). The integer
-- payroll_lop_ledger.lop_days column is NOT altered; a NEW numeric column
-- carries the exact figure and readers use COALESCE(lop_days_exact, lop_days).
-- When set, lop_days holds FLOOR(exact) as a conservative whole-day shadow.
--
-- Rollback: ALTER TABLE payroll.payroll_lop_ledger DROP COLUMN IF EXISTS lop_days_exact;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_lop_ledger ADD COLUMN IF NOT EXISTS lop_days_exact numeric(7,2);

DO $$ BEGIN
  ALTER TABLE payroll.payroll_lop_ledger ADD CONSTRAINT payroll_lop_ledger_exact_chk
    CHECK (lop_days_exact IS NULL OR lop_days_exact >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
