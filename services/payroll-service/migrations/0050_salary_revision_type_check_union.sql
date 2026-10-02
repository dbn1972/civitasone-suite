-- 0050_salary_revision_type_check_union.sql
--
-- HIGH fix (PR #1756 independent review, H1): salary revisions of type
-- 'correction' or 'fitment' were silently lost.
--
-- 0005_world_class_payroll.sql created payroll.payroll_salary_revisions with
-- an inline (unnamed) column CHECK, which Postgres auto-names
-- payroll_salary_revisions_revision_type_check:
--   CHECK (revision_type IN ('annual_increment','promotion','special',
--                            'pay_commission','market_correction'))
-- But POST /v1/payroll/salary-revisions validates against
--   z.enum(["annual_increment","promotion","correction","fitment"])
-- (src/modules/payroll/validators.ts), and the web form offers exactly those
-- four. A 'correction'/'fitment' submit is 202-accepted, the UI says it was
-- submitted, and then the salaryRevisionCreate consumer's INSERT violates
-- the CHECK -- nothing is persisted (no revision row, no HRMS basic sync,
-- no retro arrears).
--
-- Fix: widen the CHECK to the UNION of both vocabularies. The legacy values
-- stay so every existing row remains valid; nothing is narrowed, so this is
-- additive. Idempotent: DROP ... IF EXISTS + re-ADD guarded by
-- duplicate_object, safe to re-run.
--
-- NOT VALID + VALIDATE: the ADD takes only a brief ACCESS EXCLUSIVE lock
-- without scanning; VALIDATE then scans under SHARE UPDATE EXCLUSIVE. Every
-- existing row already satisfies the old (strictly narrower) CHECK, so it
-- cannot fail validation.

SET lock_timeout = '5s';

ALTER TABLE payroll.payroll_salary_revisions
  DROP CONSTRAINT IF EXISTS payroll_salary_revisions_revision_type_check;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_salary_revisions
    ADD CONSTRAINT payroll_salary_revisions_revision_type_check
    CHECK (revision_type IN (
      'annual_increment', 'promotion', 'correction', 'fitment',
      'special', 'pay_commission', 'market_correction'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE payroll.payroll_salary_revisions
  VALIDATE CONSTRAINT payroll_salary_revisions_revision_type_check;
