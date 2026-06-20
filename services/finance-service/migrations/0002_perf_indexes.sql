-- Hot-path list indexes (finance payments by tenant)
CREATE INDEX IF NOT EXISTS idx_payments_tenant_created
  ON payments.payments (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bills_tenant_status
  ON payments.bills (tenant_id, status);
