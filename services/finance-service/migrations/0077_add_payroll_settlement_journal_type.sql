-- Purpose: Add 'payroll_settlement' to finance_journals.type (and the
-- denormalized finance_journal_lines.journal_type) CHECK constraint.
--
-- gl/consumer.ts's payrollRunDisbursed handler (BL-03: payroll.run.disbursed
-- -> salary SETTLEMENT journal, clearing the net-payable liability against
-- the bank on actual disbursement) constructs and posts a journal with
-- type: "payroll_settlement". migrations/0044_expand_journal_type_constraint.sql
-- widened this constraint to cover payroll_accrual and the asset-lifecycle
-- types (asset_acquisition/impairment/revaluation/maintenance), but never
-- added payroll_settlement -- confirmed live that a direct INSERT with
-- type='payroll_settlement' fails "new row ... violates check constraint
-- finance_journals_type_check" against the current constraint, meaning this
-- is a genuinely live, reachable broken path today (every real payroll
-- disbursement's settlement journal fails to post), not a hypothetical.
--
-- Same DROP-then-ADD-NOT VALID-then-VALIDATE pattern as 0044, for the same
-- reason (a single ALTER ... ADD CONSTRAINT with a validation pass separated
-- out is safer under load than one blocking statement); idempotent and safe
-- to re-run.

SET lock_timeout = '5s';

DO $$ BEGIN
  ALTER TABLE gl.finance_journals DROP CONSTRAINT IF EXISTS finance_journals_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_type_check
  CHECK (type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_type_check;

-- Keep the denormalized journal_lines constraint in sync, matching 0044's
-- own convention of updating both together.
DO $$ BEGIN
  ALTER TABLE gl.finance_journal_lines DROP CONSTRAINT IF EXISTS finance_journal_lines_journal_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE gl.finance_journal_lines
  ADD CONSTRAINT finance_journal_lines_journal_type_check
  CHECK (journal_type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;
