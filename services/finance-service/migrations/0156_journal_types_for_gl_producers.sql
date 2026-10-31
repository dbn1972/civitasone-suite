-- 0156_journal_types_for_gl_producers.sql
-- F91 (UAT T6-03): journal types that GL producers already send but the journal-type CHECKs (gl.finance_journals.type
-- and gl.finance_journal_lines.journal_type, last defined in 0077) do not allow. Once the missing chart heads exist, every such journal would still be refused by the database
-- (23514, a plain retried error, then the DLQ) -- so no billing or revenue journal could ever post:
--   revenue_receipt, revenue_refund, billing_revenue_recognition, billing_cash_receipt  (finance revenue-billing consumer)
--   asset_capitalization, lease_recognition                                             (asset-service AUC / leases)
--   tds, adjustment                                                                     (finance tds / payments)
-- Additive: the new list is a strict superset of 0077's, so every existing row still satisfies it.
-- Idempotent: DROP ... IF EXISTS then ADD; safe to re-run.
-- Rollback (only if no row uses a new type): re-run the two constraint blocks of 0077.

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
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment'
  ));

-- Keep the denormalized journal_lines constraint in sync (0044 / 0077 convention): the GL consumer writes the journal
-- type onto every gl.finance_journal_lines row, so it refuses the same journals otherwise.
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
    'asset_capitalization', 'lease_recognition', 'tds', 'adjustment'
  ))
  NOT VALID;

ALTER TABLE gl.finance_journal_lines VALIDATE CONSTRAINT finance_journal_lines_journal_type_check;
