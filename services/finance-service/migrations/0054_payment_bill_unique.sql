-- DB-M4: Prevent duplicate payments for the same bill within a tenant (idempotent).
-- A bill can have at most one payment record (idempotency + data integrity).
DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT uq_finance_payments_tenant_bill UNIQUE (tenant_id, bill_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
