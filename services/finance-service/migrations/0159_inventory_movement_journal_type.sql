-- 0159_inventory_movement_journal_type.sql
-- UAT L2-N6: inventory-service stock receipts / issues reach the GL as journal type inventory_movement
-- (gl/inventory-movement.ts). The journal-type CHECKs (last defined in 0156) refuse it (23514), so even with the
-- consumer branch in place no stock movement could post.
-- Additive: the new list is 0156 plus inventory_movement, so every existing row still satisfies it.
-- Idempotent: DROP ... IF EXISTS then ADD; safe to re-run.
-- Rollback (only if no row uses the new type): re-run the two constraint blocks of 0156.

SET lock_timeout = '5s';

ALTER TABLE gl.finance_journals
  DROP CONSTRAINT IF EXISTS finance_journals_type_check;

ALTER TABLE gl.finance_journals
  ADD CONSTRAINT finance_journals_type_check
  CHECK (type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance',
    'revenue_receipt', 'revenue_refund', 'billing_revenue_recognition', 'billing_cash_receipt',
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment', 'inventory_movement'
  ));

ALTER TABLE gl.finance_journal_lines
  DROP CONSTRAINT IF EXISTS finance_journal_lines_journal_type_check;

ALTER TABLE gl.finance_journal_lines
  ADD CONSTRAINT finance_journal_lines_journal_type_check
  CHECK (journal_type IN (
    'journal', 'payment', 'receipt', 'contra', 'bill', 'deposit',
    'deposit_refund', 'deposit_forfeit', 'deposit_adjust', 'payroll',
    'payroll_accrual', 'payroll_settlement', 'depreciation', 'asset_disposal',
    'asset_acquisition', 'asset_impairment', 'asset_revaluation', 'asset_maintenance',
    'revenue_receipt', 'revenue_refund', 'billing_revenue_recognition', 'billing_cash_receipt',
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment', 'inventory_movement'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;
