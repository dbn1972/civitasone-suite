-- M1: prevent duplicate payments for the same bill within a tenant.
-- A bill can have at most one payment record (idempotency + data integrity).
ALTER TABLE payments.finance_payments
  ADD CONSTRAINT uq_finance_payments_tenant_bill UNIQUE (tenant_id, bill_id);
