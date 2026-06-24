-- Migration 0013: bank-account scoping for reconciliation (H2). Additive + idempotent.
-- Add bank_account_id to payments and challans so bank-recon can scope book-side
-- candidates to the statement's own bank account (a payment on account A must not
-- match a statement line imported for account B).
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS bank_account_id uuid;

ALTER TABLE treasury.finance_challans
  ADD COLUMN IF NOT EXISTS bank_account_id uuid;

CREATE INDEX IF NOT EXISTS finance_payments_bank_account_idx
  ON payments.finance_payments (tenant_id, bank_account_id);

CREATE INDEX IF NOT EXISTS finance_challans_bank_account_idx
  ON treasury.finance_challans (tenant_id, bank_account_id);
