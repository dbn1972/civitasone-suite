-- 0081_tax_proof_cutoff_setting.sql
--
-- GAP-PAYROLL-TAX-DECLARATION-02: per-tenant proof-submission cutoff, stored as
-- "MM-DD" and resolved inside each financial year (Apr-Dec -> start year,
-- Jan-Mar -> next year). Default 01-31 = 31 January of the FY. Before the
-- cutoff TDS projection uses DECLARED amounts; after it only VERIFIED proof
-- amounts count for deductions that need proof. (This is NOT the declaration
-- filing window of fin-payroll-02's tax_declaration_windows, which is a
-- different concept: when employees may submit a declaration.)
--
-- Idempotent. Rollback:
--   ALTER TABLE payroll.payroll_settings
--     DROP CONSTRAINT IF EXISTS payroll_settings_tax_proof_cutoff_chk,
--     DROP COLUMN IF EXISTS tax_proof_cutoff_md;

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS tax_proof_cutoff_md varchar(5) NOT NULL DEFAULT '01-31';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payroll_settings_tax_proof_cutoff_chk'
       AND conrelid = 'payroll.payroll_settings'::regclass
  ) THEN
    ALTER TABLE payroll.payroll_settings
      ADD CONSTRAINT payroll_settings_tax_proof_cutoff_chk
      CHECK (tax_proof_cutoff_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
  END IF;
END $$;
