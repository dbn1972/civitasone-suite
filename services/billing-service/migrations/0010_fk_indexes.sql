-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: billing-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- subscriptions.billing_subscriptions.plan_id → plans.billing_plans
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_plan_id
  ON subscriptions.billing_subscriptions (plan_id);

-- payments.billing_payments.invoice_id → invoices.billing_invoices
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_payments_invoice_id
  ON payments.billing_payments (invoice_id);

-- payments.billing_gateway_txns.payment_id → payments.billing_payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gateway_txns_payment_id
  ON payments.billing_gateway_txns (payment_id);
