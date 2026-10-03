-- 0070_flex_election_approval.sql
--
-- GAP-PAYROLL-FLEX-BENEFITS-05: HR approval of flex-benefit elections.
-- An election changes an employee's pay / tax exemptions, so it is now
-- "submitted" -> "approved" | "rejected" by a payroll officer other than the
-- maker (maker-checker), behind a per-tenant switch that defaults ON.
--
-- Idempotent. Rollback:
--   ALTER TABLE payroll.flex_benefit_elections
--     DROP CONSTRAINT IF EXISTS flex_benefit_elections_status_check,
--     DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS review_reason;
--   ALTER TABLE payroll.payroll_settings DROP COLUMN IF EXISTS flex_election_maker_checker;
--   DROP INDEX IF EXISTS payroll.flex_benefit_elections_status_idx;

ALTER TABLE payroll.flex_benefit_elections
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'flex_benefit_elections_status_check'
       AND conrelid = 'payroll.flex_benefit_elections'::regclass
  ) THEN
    ALTER TABLE payroll.flex_benefit_elections
      ADD CONSTRAINT flex_benefit_elections_status_check
      CHECK (status IN ('submitted', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS flex_benefit_elections_status_idx
  ON payroll.flex_benefit_elections (tenant_id, status, created_at DESC, id);

-- Default ON: the officer who submitted an election may not also approve it.
-- A tenant that cannot staff two officers may switch it off.
ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS flex_election_maker_checker BOOLEAN NOT NULL DEFAULT TRUE;
