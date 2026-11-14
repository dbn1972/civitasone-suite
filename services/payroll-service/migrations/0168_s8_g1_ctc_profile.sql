-- 0168_s8_g1_ctc_profile.sql
--
-- Section 8 gap G1: the private CTC salary profile (ctc_contract). The CTC terms live on the HRMS pay profile
-- (hrms migration 0269); the breakup is computed per month from the LOCKED ctc_template version (G2, 0170) and
-- booked on the slip as ordinary earning lines. This migration only adds the slip-side facts that reports and
-- the G7 costing need without parsing JSON: which template version produced the slip, and the employer-side
-- figures that are not slip deductions.
--
-- Additive, nullable, no default (no table rewrite): NULL on every existing slip and on every non-CTC slip, so
-- government tenants are untouched. No statutory figure is stored or seeded here. No FK to payroll_structures
-- on purpose (a soft reference, so a template can never block slip history or take a heavy lock).
--
--   employer_esi_minor        employer ESI the slip booked (paise); NULL = not a CTC slip, 0 = none due
--   gratuity_provision_minor  gratuity provision for the month (paise): an accrual, never paid on the slip
--
-- Idempotent. Rollback:
--   ALTER TABLE payroll.payroll_slips DROP COLUMN IF EXISTS ctc_template_id, DROP COLUMN IF EXISTS ctc_template_version,
--     DROP COLUMN IF EXISTS employer_esi_minor, DROP COLUMN IF EXISTS gratuity_provision_minor;

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_slips ADD COLUMN IF NOT EXISTS ctc_template_id uuid;
ALTER TABLE payroll.payroll_slips ADD COLUMN IF NOT EXISTS ctc_template_version integer;
ALTER TABLE payroll.payroll_slips ADD COLUMN IF NOT EXISTS employer_esi_minor bigint;
ALTER TABLE payroll.payroll_slips ADD COLUMN IF NOT EXISTS gratuity_provision_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_slips_ctc_amounts_check') THEN
    ALTER TABLE payroll.payroll_slips ADD CONSTRAINT payroll_slips_ctc_amounts_check
      CHECK ((employer_esi_minor IS NULL OR employer_esi_minor >= 0) AND (gratuity_provision_minor IS NULL OR gratuity_provision_minor >= 0)) NOT VALID;
  END IF;
END $$;
ALTER TABLE payroll.payroll_slips VALIDATE CONSTRAINT payroll_slips_ctc_amounts_check;
