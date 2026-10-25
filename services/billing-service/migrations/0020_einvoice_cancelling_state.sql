-- 0020_einvoice_cancelling_state.sql
-- CLOS3-S4-02: allow a `cancelling` e-invoice request status. The cancel consumer now claims the
-- row (generated -> cancelling) inside the same transaction that records the inbox message and
-- only then calls NIC, so a redelivered / concurrent cancel command can never call NIC twice.
-- Idempotent. Rollback: set any `cancelling` rows back to `generated` (or `failed`), then re-add
-- the constraint with the original four values:
--   ALTER TABLE einvoice.billing_einvoice_requests DROP CONSTRAINT billing_einvoice_requests_status_check;
--   ALTER TABLE einvoice.billing_einvoice_requests ADD CONSTRAINT billing_einvoice_requests_status_check
--     CHECK (status IN ('pending','generated','failed','cancelled'));
-- Affected services: billing-service

SET lock_timeout = '5s';

ALTER TABLE einvoice.billing_einvoice_requests
  DROP CONSTRAINT IF EXISTS billing_einvoice_requests_status_check;

ALTER TABLE einvoice.billing_einvoice_requests
  ADD CONSTRAINT billing_einvoice_requests_status_check
  CHECK (status IN ('pending', 'generated', 'failed', 'cancelled', 'cancelling'))
  NOT VALID;

ALTER TABLE einvoice.billing_einvoice_requests VALIDATE CONSTRAINT billing_einvoice_requests_status_check;
