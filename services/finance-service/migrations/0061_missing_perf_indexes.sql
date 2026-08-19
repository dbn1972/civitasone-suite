-- DB-M2: Add missing composite tenant+status indexes for common query patterns.
-- CONCURRENTLY: must be run outside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fbills_tenant_status_created
  ON payments.finance_bills (tenant_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fpayments_tenant_status
  ON payments.finance_payments (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fjournals_tenant_status_date
  ON gl.finance_journals (tenant_id, status, posting_date DESC);
