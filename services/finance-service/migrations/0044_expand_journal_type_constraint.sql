-- Purpose: Expand finance_journals.type CHECK constraint to include asset lifecycle types
-- that the fixed-asset register route queries for (asset_acquisition, asset_impairment,
-- asset_revaluation, asset_maintenance). These types are posted by asset-service consumers
-- when recording fixed-asset lifecycle events in the GL.
--
-- Rollback: Re-apply the original constraint without asset lifecycle types (only safe if no
-- rows exist with the new type values).
--
-- Affected services: finance-service (fixed-asset register reconciliation)

SET lock_timeout = '5s';

-- Drop the existing constraint and re-add with the expanded set.
DO $$ BEGIN
  ALTER TABLE gl.finance_journals DROP CONSTRAINT IF EXISTS finance_journals_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_type_check
  CHECK (type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_type_check;

-- Also expand the denormalized journal_lines table constraint to match.
DO $$ BEGIN
  ALTER TABLE gl.finance_journal_lines DROP CONSTRAINT IF EXISTS finance_journal_lines_journal_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE gl.finance_journal_lines
  ADD CONSTRAINT finance_journal_lines_journal_type_check
  CHECK (journal_type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;
