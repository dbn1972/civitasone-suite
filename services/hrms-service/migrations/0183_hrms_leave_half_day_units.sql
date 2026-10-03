-- 0183_hrms_leave_half_day_units.sql
--
-- GAP-HR-LEAVE-APPLY-05: half-day CL / short leave. Additive only -- the
-- existing INTEGER columns (days_applied, total_days, balance_days) are NOT
-- altered, so every reader/writer that still treats them as whole days keeps
-- working. Half-day quantities live in NEW numeric columns (0.5-day units):
--
--   hrms_leave_apps.days_applied_exact   numeric(5,1)  NULL = whole-day row (use days_applied)
--   hrms_leave_apps.day_part             'full' | 'first_half' | 'second_half' | 'short_leave'
--   hrms_leave_allocs.balance_days_exact numeric(6,1)  NULL = never fractionally touched (use balance_days)
--
-- Convention when a fractional quantity is stored: the integer column keeps a
-- SAFE whole-day shadow -- days_applied = CEIL(exact) (a half day still
-- occupies one calendar day on the legacy value), balance_days =
-- FLOOR(balance exact) (a legacy reader never sees more balance than exists).
-- Consumers that matter for money (payroll LOP, F&F encashment) read the exact
-- columns via the event payload / API.
--
-- Rollback:
--   ALTER TABLE leave.hrms_leave_apps DROP COLUMN IF EXISTS day_part, DROP COLUMN IF EXISTS days_applied_exact;
--   ALTER TABLE leave.hrms_leave_allocs DROP COLUMN IF EXISTS balance_days_exact;

SET lock_timeout = '5s';

ALTER TABLE leave.hrms_leave_apps ADD COLUMN IF NOT EXISTS day_part varchar(16) NOT NULL DEFAULT 'full';
ALTER TABLE leave.hrms_leave_apps ADD COLUMN IF NOT EXISTS days_applied_exact numeric(5,1);
ALTER TABLE leave.hrms_leave_allocs ADD COLUMN IF NOT EXISTS balance_days_exact numeric(6,1);

DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_apps ADD CONSTRAINT hrms_leave_apps_day_part_chk
    CHECK (day_part IN ('full','first_half','second_half','short_leave'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_apps ADD CONSTRAINT hrms_leave_apps_days_exact_chk
    CHECK (days_applied_exact IS NULL OR (days_applied_exact > 0 AND days_applied_exact * 2 = round(days_applied_exact * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leave.hrms_leave_allocs ADD CONSTRAINT hrms_leave_allocs_balance_exact_chk
    CHECK (balance_days_exact IS NULL OR (balance_days_exact >= 0 AND balance_days_exact * 2 = round(balance_days_exact * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
