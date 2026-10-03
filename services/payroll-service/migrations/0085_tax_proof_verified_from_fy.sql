-- 0085_tax_proof_verified_from_fy.sql
--
-- GAP-PAYROLL-TAX-DECLARATION-02 (review): explicit per-tenant OPT-IN for the
-- verified-amount TDS switch. NULL (the default for every existing tenant)
-- means OFF: TDS, Form 16 and the computation keep using declared amounts, also
-- for closed financial years. A value such as '2026-27' turns the switch on for
-- that FY and later ones (the proof cutoff in 0081 still decides WHEN inside
-- the FY). Set by payroll_admin only, audited before and after.
--
-- Idempotent. Rollback:
--   ALTER TABLE payroll.payroll_settings
--     DROP CONSTRAINT IF EXISTS payroll_settings_tax_proof_verified_from_fy_chk,
--     DROP COLUMN IF EXISTS tax_proof_verified_from_fy;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS tax_proof_verified_from_fy varchar(7);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_settings_tax_proof_verified_from_fy_chk'
       AND conrelid = 'payroll.payroll_settings'::regclass
  ) THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_tax_proof_verified_from_fy_chk
      CHECK (tax_proof_verified_from_fy IS NULL OR tax_proof_verified_from_fy ~ '^[0-9]{4}-[0-9]{2}$');
  END IF;
END $$;
