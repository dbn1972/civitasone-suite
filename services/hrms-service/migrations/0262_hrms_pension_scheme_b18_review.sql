-- 0262_hrms_pension_scheme_b18_review.sql
--
-- PR #2458 review should-fix items (ERP-head decisions 2026-11-05).
--
-- SF4  to_scheme of a history row may be CPF (an "initial" backfill row of a
--      CPF member used to violate hrms_pension_scheme_changes_to_check and
--      abort the backfill) or NONE (SF6).
-- SF6  NONE = no pension scheme (apprentices under the Apprentices Act,
--      consultants): a valid recorded scheme.
-- SF1  EPF membership facts for EPS eligibility (EPS 1995 para 6A, as
--      amended 22.08.2014), on the employee and on the change request that
--      sets them:
--        epf_first_joined_on         date the member first joined EPF anywhere
--                                    (carried via the UAN); NULL = the joining date
--        epf_voluntary_joint_option  member by joint option under para 26(6) EPF
--                                    Scheme (wages above the ceiling at joining)
--        eps_member                  explicit EPS membership; NULL = derived
-- SF5  override_reason: a scheme change outside the eligibility matrix is
--      allowed only with a reason recorded by a super_admin.
-- kind  + membership (EPF -> EPF: only the membership facts change).
-- FK    history is immutable: ON DELETE RESTRICT instead of CASCADE.
--
-- Additive and idempotent (guarded). Rollback: drop the added columns,
-- restore the 0261 checks and the CASCADE FK.

SET lock_timeout = '5s';

ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS chk_hrms_employees_pension_scheme;
ALTER TABLE employee.hrms_employees
  ADD CONSTRAINT chk_hrms_employees_pension_scheme
  CHECK (pension_scheme IN ('GPF', 'NPS', 'EPF', 'CPF', 'UPS', 'NONE')) NOT VALID;
ALTER TABLE employee.hrms_employees VALIDATE CONSTRAINT chk_hrms_employees_pension_scheme;

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS epf_first_joined_on        date,
  ADD COLUMN IF NOT EXISTS epf_voluntary_joint_option boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eps_member                 boolean;

ALTER TABLE employee.hrms_pension_scheme_changes
  ADD COLUMN IF NOT EXISTS override_reason            text,
  ADD COLUMN IF NOT EXISTS epf_first_joined_on        date,
  ADD COLUMN IF NOT EXISTS epf_voluntary_joint_option boolean,
  ADD COLUMN IF NOT EXISTS eps_member                 boolean;

ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_to_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_to_check
  CHECK (to_scheme IN ('GPF', 'NPS', 'EPF', 'UPS', 'CPF', 'NONE'));
ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_kind_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_kind_check
  CHECK (kind IN ('change', 'membership', 'initial', 'correction'));
ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_changed_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_changed_check
  CHECK (kind IN ('initial', 'membership') OR from_scheme <> to_scheme);
ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_backfill_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_backfill_check
  CHECK (kind IN ('change', 'membership') OR status = 'approved');
ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT IF EXISTS hrms_pension_scheme_changes_override_check;
ALTER TABLE employee.hrms_pension_scheme_changes ADD CONSTRAINT hrms_pension_scheme_changes_override_check
  CHECK (override_reason IS NULL OR length(btrim(override_reason)) >= 20);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_hrms_pension_scheme_changes_employee'
      AND conrelid = 'employee.hrms_pension_scheme_changes'::regclass
      AND confdeltype = 'c'
  ) THEN
    ALTER TABLE employee.hrms_pension_scheme_changes DROP CONSTRAINT fk_hrms_pension_scheme_changes_employee;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_hrms_pension_scheme_changes_employee'
      AND conrelid = 'employee.hrms_pension_scheme_changes'::regclass
  ) THEN
    ALTER TABLE employee.hrms_pension_scheme_changes
      ADD CONSTRAINT fk_hrms_pension_scheme_changes_employee
      FOREIGN KEY (employee_id) REFERENCES employee.hrms_employees(id) ON DELETE RESTRICT;
  END IF;
END $$;
