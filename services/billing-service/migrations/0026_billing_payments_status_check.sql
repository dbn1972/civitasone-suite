-- 0026_billing_payments_status_check.sql
-- UAT g3 #2: POST /billing/payments answered 202 but never recorded. payments/consumer.ts (and
-- invoice-ops/consumer.ts) insert status 'completed', but the live billing_payments_status_check
-- allowed only pending/received/failed/refunded (a different definition than 0009's, which was
-- skipped by 0009's `EXCEPTION WHEN duplicate_object THEN NULL`). Every payment hit the CHECK, was
-- retried 5x and dead-lettered; invoice.paid_minor stayed 0.
-- Converge every environment on one definition: the union of the code's state ('completed') and
-- the states seen on drifted databases. DROP+ADD is idempotent; NOT VALID then VALIDATE keeps the
-- ACCESS EXCLUSIVE window short. Existing rows already satisfy the wider set.
-- Rollback: re-create the constraint with the narrower list (only if no row uses the new states).

SET lock_timeout = '5s';

ALTER TABLE payments.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_status_check;
ALTER TABLE payments.billing_payments
  ADD CONSTRAINT billing_payments_status_check
  CHECK (status IN ('pending', 'completed', 'received', 'failed', 'refunded'))
  NOT VALID;
ALTER TABLE payments.billing_payments VALIDATE CONSTRAINT billing_payments_status_check;
