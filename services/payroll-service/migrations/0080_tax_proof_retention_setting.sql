-- 0080_tax_proof_retention_setting.sql
--
-- GAP-PAYROLL-TAX-DECLARATION-02: tenant-admin-controlled retention of
-- investment-proof files, in whole years counted from the END of the financial
-- year the proof belongs to. Default 8 (IT Act / record-keeping norms are
-- commonly read as 6-8 years -- the tenant should confirm), allowed 1-10.
--
-- Idempotent. Rollback:
--   ALTER TABLE payroll.payroll_settings
--     DROP CONSTRAINT IF EXISTS payroll_settings_tax_proof_retention_chk,
--     DROP COLUMN IF EXISTS tax_proof_retention_years;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS tax_proof_retention_years integer NOT NULL DEFAULT 8;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_settings_tax_proof_retention_chk'
       AND conrelid = 'payroll.payroll_settings'::regclass
  ) THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_tax_proof_retention_chk
      CHECK (tax_proof_retention_years BETWEEN 1 AND 10);
  END IF;
END $$;
