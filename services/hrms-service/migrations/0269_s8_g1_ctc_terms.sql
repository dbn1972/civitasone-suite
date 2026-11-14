-- 0269_s8_g1_ctc_terms.sql
--
-- Section 8 gap G1: the approved CTC terms of a ctc_contract pay profile (HRMS side; payroll migration 0168
-- holds the slip-side columns). One nullable jsonb column, the same pattern as deputation_terms:
--   { annualFixedMinor, annualVariableTargetMinor, templateLineageId, epfWagePolicy: 'ceiling'|'actual',
--     esiOptOut, gratuityProvisionOn, overrides: [{ code, monthlyMinor }] }   -- money as digit strings
-- Maker-checker, effective-dating and the "start on the 1st" rule are the existing pay-profile ones.
--
-- NULL on every existing row. The CHECK is one-directional on purpose (CTC terms only on a ctc_contract row):
-- a ctc_contract row recorded BEFORE this feature (accepted and approved with no terms while payroll refused
-- it) must stay updatable (approval closes the previous open row), so "ctc_contract => terms" is enforced by
-- the request validation behind S8_CTC_PROFILE_ENABLED, not by the database.
-- No statutory figure here. Additive, idempotent. Rollback:
--   ALTER TABLE employee.hrms_pay_profiles DROP CONSTRAINT IF EXISTS hrms_pay_profiles_ctc_terms_chk;
--   ALTER TABLE employee.hrms_pay_profiles DROP COLUMN IF EXISTS ctc_terms;

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_pay_profiles ADD COLUMN IF NOT EXISTS ctc_terms jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_pay_profiles_ctc_terms_chk') THEN
    ALTER TABLE employee.hrms_pay_profiles ADD CONSTRAINT hrms_pay_profiles_ctc_terms_chk
      CHECK (ctc_terms IS NULL OR pay_profile = 'ctc_contract') NOT VALID;
  END IF;
END $$;
ALTER TABLE employee.hrms_pay_profiles VALIDATE CONSTRAINT hrms_pay_profiles_ctc_terms_chk;
