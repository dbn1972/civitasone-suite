-- 0190_advances_recovery_mode.sql
-- C25 / GAP-FINANCE-EXPENDITURE-ADVANCES-03 (owner decision 2026-11-26). Additive and idempotent.
--   payments.finance_advances gains recovery_mode: how the advance is recovered -- 'salary' | 'cash' | 'adjust_against_bill'.
--   NULL = not recorded (every existing row; the defaults ARE the backfill, nothing is guessed), so existing reads and writes are unchanged.
-- Rollback: ALTER TABLE payments.finance_advances DROP CONSTRAINT IF EXISTS finance_advances_recovery_mode_valid,
--             DROP COLUMN IF EXISTS recovery_mode;   (only while no advance relies on it).

SET lock_timeout = '5s';

ALTER TABLE payments.finance_advances ADD COLUMN IF NOT EXISTS recovery_mode varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_advances_recovery_mode_valid' AND conrelid = 'payments.finance_advances'::regclass) THEN
    ALTER TABLE payments.finance_advances ADD CONSTRAINT finance_advances_recovery_mode_valid
      CHECK (recovery_mode IS NULL OR recovery_mode IN ('salary', 'cash', 'adjust_against_bill')) NOT VALID;
  END IF;
END $$;

ALTER TABLE payments.finance_advances VALIDATE CONSTRAINT finance_advances_recovery_mode_valid;
