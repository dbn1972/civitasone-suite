-- Purpose: FN-14 sandbox confirm writes reconciliation_status='sandbox' (an
-- explicitly labelled Test/Sandbox capture, distinct from a real 'reconciled'
-- gateway settlement — see fee-payment/consumer.ts confirmPayment handler and
-- domain.ts's honesty-gate comment). The original CHECK constraint from
-- 0015_service_gaps.sql only allowed unreconciled/reconciled/disputed, so
-- every sandbox confirm violated the constraint and rolled back silently
-- (payment stuck "pending" forever). Add 'sandbox' to the allowed set.
-- Affected services: citizen-service
-- Rollback: re-add the narrower CHECK (will fail if any 'sandbox' rows exist)

SET lock_timeout = '5s';

ALTER TABLE fee.payments
  DROP CONSTRAINT IF EXISTS payments_reconciliation_status_check;

ALTER TABLE fee.payments
  ADD CONSTRAINT payments_reconciliation_status_check
  CHECK (reconciliation_status IN ('unreconciled', 'reconciled', 'disputed', 'sandbox'));
