-- 0068_fin03_salary_revision_maker_checker.sql
--
-- GAP-PAYROLL-SALARY-REVISIONS-04 (remainder): maker != checker for salary
-- revisions. DEFAULT POLICY (configurable, VERIFY): ON for every tenant. A new
-- revision is 'pending' and affects neither payroll computation nor the HRMS
-- basic-pay sync until a DIFFERENT user approves it.
--
-- Rows written before this migration are back-filled 'approved' (they were
-- already live), so nothing already in flight changes. Idempotent.

ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'approved';
ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS decided_by UUID;
ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE payroll.payroll_salary_revisions ADD COLUMN IF NOT EXISTS decision_note TEXT;

-- Historic rows: the legacy writer stored the creating actor in approved_by.
UPDATE payroll.payroll_salary_revisions SET created_by = approved_by WHERE created_by IS NULL;

DO $$ BEGIN
  ALTER TABLE payroll.payroll_salary_revisions ADD CONSTRAINT payroll_salary_revisions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_salary_revisions_tenant_status
  ON payroll.payroll_salary_revisions (tenant_id, status, effective_date DESC);

-- Per-tenant switch (default ON).
ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS salary_revision_second_approver BOOLEAN NOT NULL DEFAULT TRUE;
