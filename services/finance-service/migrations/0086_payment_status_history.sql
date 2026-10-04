-- Migration 0086: payment status history (fp-finance-02)
--
-- GAP-FINANCE-PAYMENTS-DETAIL-04: the payment detail page needs a status
-- timeline. payments.finance_payments only holds the CURRENT status, so every
-- status write (initiated, pending_approval, released, cancelled, failed) now
-- also appends a row here, in the same transaction. Existing payments get one
-- backfilled 'initiated' event from their created_at / created_by; later
-- transitions that happened before this migration are not reconstructable and
-- are not invented.

CREATE TABLE IF NOT EXISTS payments.finance_payment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  payment_id  uuid NOT NULL,
  status      varchar(24) NOT NULL,
  actor_id    uuid,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payments.finance_payment_events(tenant_id, payment_id, created_at);

ALTER TABLE payments.finance_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments.finance_payment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payments.finance_payment_events;
CREATE POLICY tenant_isolation_policy ON payments.finance_payment_events
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

-- Backfill (idempotent): one 'initiated' event per payment that has none yet.
-- The migration role bypasses RLS for this one-off data copy.
INSERT INTO payments.finance_payment_events (tenant_id, payment_id, status, actor_id, created_at)
SELECT p.tenant_id, p.id, 'initiated', p.created_by, p.created_at
FROM payments.finance_payments p
WHERE NOT EXISTS (
  SELECT 1 FROM payments.finance_payment_events e WHERE e.tenant_id = p.tenant_id AND e.payment_id = p.id
);
