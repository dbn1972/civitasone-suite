-- Migration 0106: Schema integrity — FK constraints, covering indexes, unique constraints
--
-- Pre-checks confirmed (2026-08-12):
--   All 6 target tables present in correct schema-qualified locations.
--   Zero FK constraints exist on any of the 5 target tables.
--   leave.hrms_leave_allocations does NOT exist → items 6a/6b skipped.
--   hrms_gpf_accounts_uq already backs UNIQUE(tenant_id, employee_id) → uq_gpf_accounts_tenant_employee skipped.
--   employee.hrms_loans / hrms_salary_advances lack updated_at/updated_by → columns added.
--
-- Note: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS syntax; guards use DO blocks.
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

BEGIN;

-- ─── 1. APAR scores indexes (appraisal schema) ────────────────────────────────
-- Drop any stale copies created on public schema by mistake.
DROP INDEX IF EXISTS public.idx_hrms_apar_scores_appraisal_id;
DROP INDEX IF EXISTS public.idx_hrms_apar_scores_employee_id;

-- Point lookup by appraisal_id on the correct schema.
CREATE INDEX IF NOT EXISTS idx_hrms_apar_scores_appraisal_id
  ON appraisal.hrms_apar_scores(appraisal_id);

-- Covering index for (appraisal_id, score) used by scoring roll-up queries.
CREATE INDEX IF NOT EXISTS idx_hrms_apar_scores_employee_id
  ON appraisal.hrms_apar_scores(appraisal_id, score);

-- ─── 2. FK: employee.hrms_loans → employee.hrms_employees ────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_loans_employee_id'
  ) THEN
    ALTER TABLE employee.hrms_loans
      ADD CONSTRAINT fk_loans_employee_id
      FOREIGN KEY (employee_id) REFERENCES employee.hrms_employees(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_loans_employee_id
  ON employee.hrms_loans(employee_id);

-- ─── 3. FK: employee.hrms_salary_advances → employee.hrms_employees ──────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_salary_advances_employee_id'
  ) THEN
    ALTER TABLE employee.hrms_salary_advances
      ADD CONSTRAINT fk_salary_advances_employee_id
      FOREIGN KEY (employee_id) REFERENCES employee.hrms_employees(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_id
  ON employee.hrms_salary_advances(employee_id);

-- ─── 4. Add updated_at / updated_by to loans and salary_advances ──────────────
ALTER TABLE employee.hrms_loans
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE employee.hrms_salary_advances
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- ─── 5. GPF unique constraints ────────────────────────────────────────────────
-- uq on (tenant_id, employee_id) already exists as constraint hrms_gpf_accounts_uq → skip.
-- Add the missing unique on (tenant_id, gpf_number).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_gpf_accounts_tenant_gpf_number'
  ) THEN
    ALTER TABLE gpf.hrms_gpf_accounts
      ADD CONSTRAINT uq_gpf_accounts_tenant_gpf_number
      UNIQUE (tenant_id, gpf_number);
  END IF;
END $$;

-- ─── 6. FK: leave.hrms_leave_conversions → leave.hrms_leave_allocations ───────
-- SKIPPED: leave.hrms_leave_allocations does not yet exist.
-- Add fk_leave_conv_from_alloc / fk_leave_conv_to_alloc in the migration
-- that creates hrms_leave_allocations.

-- ─── 7. FK: recruitment.hrms_interview_scores → recruitment.hrms_interviews ──
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_interview_scores_interview_id'
  ) THEN
    ALTER TABLE recruitment.hrms_interview_scores
      ADD CONSTRAINT fk_interview_scores_interview_id
      FOREIGN KEY (interview_id) REFERENCES recruitment.hrms_interviews(id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
