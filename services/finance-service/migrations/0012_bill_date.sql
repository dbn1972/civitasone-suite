-- Migration 0012: add posting/value date to bills so period hard-close is
-- enforced against the document's own date (not wall-clock). Additive + idempotent.
ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS bill_date date;
