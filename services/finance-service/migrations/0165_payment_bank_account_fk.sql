-- Migration 0165: finance_payments.bank_account_id references the bank-account master
--
-- BUG: fk_fpayments_bank (0055) pointed bank_account_id at treasury.finance_banks, a table
-- no product API writes (the banks route is a balance GET only; 0 rows in every tenant).
-- The accounts users actually create (POST /v1/finance/bank-accounts, 0066) live in
-- payments.finance_bank_accounts. So any payment carrying a bankAccountId failed with an
-- FK violation, was retried to exhaustion and dead-lettered.
--
-- bank_account_id means "which of the office's own accounts this payment is disbursed
-- FROM" (bank-recon matches a statement's account against it). That is exactly what the
-- bank-account master holds ("the office's bank accounts for payments, EFT, reconciliation"),
-- so the FK is repointed there. Additive and idempotent:
--   * the old constraint is dropped only if present, the new one added only if absent;
--   * the new FK is added NOT VALID (enforced for every new write at once), then validated.
--     If an environment holds legacy rows that reference treasury.finance_banks ids, the
--     validation is skipped with a NOTICE and the constraint stays NOT VALID rather than
--     failing the migration -- those rows are untouched.
-- Tenant and status are not expressible in a plain FK; the route (422 BANK_ACCOUNT_NOT_FOUND)
-- and the finance.payment.initiate consumer (NonRetryableError) check them.
-- Column values are not rewritten; bank-recon / instruments / challans keep their own columns.

-- Fail fast instead of queueing behind (and blocking) traffic on a busy payments table.
SET lock_timeout = '5s';

ALTER TABLE payments.finance_payments DROP CONSTRAINT IF EXISTS fk_fpayments_bank;

DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT fk_fpayments_bank_account FOREIGN KEY (bank_account_id)
    REFERENCES payments.finance_bank_accounts (id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE payments.finance_payments VALIDATE CONSTRAINT fk_fpayments_bank_account;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'fk_fpayments_bank_account left NOT VALID: legacy finance_payments.bank_account_id values do not exist in payments.finance_bank_accounts';
END $$;

RESET lock_timeout;
