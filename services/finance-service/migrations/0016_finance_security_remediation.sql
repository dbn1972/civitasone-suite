-- 0016 finance security remediation (C2 / H1) — additive + idempotent.
-- C2: guarded deposit disposition relies on a SQL balance guard (no schema
--     change needed beyond what 0015 shipped); add a non-negative balance
--     CHECK so balance can never go negative even if app logic regresses.
-- H1: PFMS bank file must contain ONLY the batch's payment set. There was no
--     membership link between payments.finance_payments and payments.finance_pfms.
--     Add a nullable pfms_id tag so a batch can claim its payments, and index it.

-- H1: tag payments with the PFMS batch's pfms_id (RBI/PFMS txn id). Nullable;
-- existing rows stay NULL and therefore belong to no batch's file.
ALTER TABLE payments.finance_payments
  ADD COLUMN IF NOT EXISTS pfms_id text;

CREATE INDEX IF NOT EXISTS idx_fpayments_pfms
  ON payments.finance_payments (tenant_id, pfms_id);

-- C2: defence-in-depth — held deposit balance must never be negative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_finance_deposits_balance_nonneg'
  ) THEN
    ALTER TABLE treasury.finance_deposits
      ADD CONSTRAINT chk_finance_deposits_balance_nonneg
      CHECK (balance_minor >= 0);
  END IF;
END$$;
