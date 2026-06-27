-- finance-service: sample-data marker for bills.
-- Additive, idempotent, forward-only. Safe to re-run.
-- Marks clearly-labelled "[SAMPLE]" bills a new office can add to explore the
-- Bill Processing screen, then clear in one action. Clearing deletes ONLY rows
-- where is_sample = true, so real bills are never affected.

ALTER TABLE payments.finance_bills
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_finance_bills_tenant_sample
  ON payments.finance_bills(tenant_id, is_sample);
