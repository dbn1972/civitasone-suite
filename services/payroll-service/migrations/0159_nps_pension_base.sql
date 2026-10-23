-- 0159_nps_pension_base.sql
--
-- GAP-PAYROLL-STATUTORY-NPS-05: the NPS ledger row stored `basic_minor` (Basic
-- only), but the 10% / 14% contributions are applied to the pension base
-- (Basic + DA; the FR 53 suspension-adjusted base for a suspended member --
-- see computeSlip in modules/payroll/domain.ts). With only Basic on the row the
-- contribution could not be checked by eye against the percentage.
--
-- `pension_base_minor` records the exact base the percentages were applied to
-- (bigint paise), written by the payroll consumer in the same transaction as the
-- row. NULL on every row written before this migration: the base of a past
-- month is NOT reconstructed (DA / suspension adjustments are not recoverable
-- from the row), so the web shows "-" for those rows instead of a guess.
--
-- Nullable, additive: no existing row, constraint or policy changes. The
-- table keeps its FORCE ROW LEVEL SECURITY tenant policy (0026).
--
-- Idempotent. Rollback:
--   ALTER TABLE statutory.payroll_nps
--     DROP CONSTRAINT IF EXISTS payroll_nps_pension_base_nonneg_chk,
--     DROP COLUMN IF EXISTS pension_base_minor;

SET lock_timeout = '5s';

ALTER TABLE statutory.payroll_nps
  ADD COLUMN IF NOT EXISTS pension_base_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_nps_pension_base_nonneg_chk'
       AND conrelid = 'statutory.payroll_nps'::regclass
  ) THEN
    ALTER TABLE statutory.payroll_nps
      ADD CONSTRAINT payroll_nps_pension_base_nonneg_chk
      CHECK (pension_base_minor IS NULL OR pension_base_minor >= 0);
  END IF;
END $$;
