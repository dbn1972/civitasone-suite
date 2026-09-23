-- DB-M4: Prevent duplicate payments for the same bill within a tenant (idempotent).
-- A bill can have at most one payment record (idempotency + data integrity).
DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT uq_finance_payments_tenant_bill UNIQUE (tenant_id, bill_id);
-- UNIQUE constraints create a backing index implicitly; Postgres raises
-- duplicate_table (42P07) for THAT name collision, not duplicate_object
-- (42710) -- unlike a CHECK/FK constraint of the same name. Both must be
-- caught for this guard to actually be idempotent on a second run.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
