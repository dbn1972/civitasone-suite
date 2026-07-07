-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: finance-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- budget.finance_budgets.head_id → budget.finance_heads
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fbudgets_head_id
  ON budget.finance_budgets (head_id);

-- budget.finance_sanctions.head_id → budget.finance_heads
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fsanctions_head_id
  ON budget.finance_sanctions (head_id);

-- treasury.finance_challans.receipt_head_id → budget.finance_heads
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fchallans_receipt_head_id
  ON treasury.finance_challans (receipt_head_id);

-- payments.finance_bills.vendor_id (external FK lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fbills_vendor_id
  ON payments.finance_bills (vendor_id);

-- payments.finance_bills.head_id → budget.finance_heads
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fbills_head_id
  ON payments.finance_bills (head_id);

-- payments.finance_bills.sanction_ref (FK lookup to sanctions)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fbills_sanction_ref
  ON payments.finance_bills (sanction_ref) WHERE sanction_ref IS NOT NULL;

-- payments.finance_payments.bill_id already indexed (idx_fpayments_bill) — skip
