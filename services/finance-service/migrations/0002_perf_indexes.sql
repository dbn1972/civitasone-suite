-- Hot-path list indexes (finance payments by tenant)
CREATE INDEX IF NOT EXISTS idx_payments_tenant_created
  ON payments.finance_payments (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bills_tenant_status
  ON payments.finance_bills (tenant_id, status);
