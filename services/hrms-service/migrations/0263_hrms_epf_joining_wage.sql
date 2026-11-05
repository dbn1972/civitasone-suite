-- 0263_hrms_epf_joining_wage.sql
--
-- PR #2458 delta review (ERP-head decision 2026-11-05): EPS eligibility is
-- decided only from recorded facts (para 6A tests the wages at FIRST joining
-- EPF, once). epf_joining_wage_minor = EPF wages (Basic + DA, paise) at first
-- joining EPF, stamped ONCE at hire or at EPF enrolment (an approved change
-- to EPF or an EPF membership request); never overwritten by a later request.
-- Also carried on the change request that sets it. NULL = not recorded.
--
-- Additive and idempotent. Rollback: drop the two columns.

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees ADD COLUMN IF NOT EXISTS epf_joining_wage_minor bigint;
ALTER TABLE employee.hrms_pension_scheme_changes ADD COLUMN IF NOT EXISTS epf_joining_wage_minor bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_employees_epf_joining_wage_nonneg_chk'
                   AND conrelid = 'employee.hrms_employees'::regclass) THEN
    ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_epf_joining_wage_nonneg_chk
      CHECK (epf_joining_wage_minor IS NULL OR epf_joining_wage_minor >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrms_pension_scheme_changes_joining_wage_nonneg_chk'
                   AND conrelid = 'employee.hrms_pension_scheme_changes'::regclass) THEN
    ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_joining_wage_nonneg_chk
      CHECK (epf_joining_wage_minor IS NULL OR epf_joining_wage_minor >= 0);
  END IF;
END $$;
ALTER TABLE employee.hrms_employees VALIDATE CONSTRAINT hrms_employees_epf_joining_wage_nonneg_chk;
