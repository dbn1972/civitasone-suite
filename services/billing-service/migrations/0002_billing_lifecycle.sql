-- billing-service: bill lifecycle to Tier-2 bar (additive + idempotent).
-- Applied with billing_svc on civitas_billing.
-- Adds: tax/charges, partial-payment tracking (paid_minor), partially_paid + cancelled
-- states, maker-checker approvals on issue/cancel, payment receipts against a bill.

-- ── invoices: lifecycle + money columns ───────────────────────────

ALTER TABLE invoices.billing_invoices
  ADD COLUMN IF NOT EXISTS tax_minor      bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_minor  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_minor     bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason  text,
  ADD COLUMN IF NOT EXISTS issued_by      uuid,
  ADD COLUMN IF NOT EXISTS cancelled_by   uuid;

-- Widen the status CHECK to the full lifecycle. Drop the old constraint by its
-- conventional name if present, then re-add the superset (idempotent: NOT VALID
-- re-add guarded by catalog lookup).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_invoices_status_check'
      AND conrelid = 'invoices.billing_invoices'::regclass
  ) THEN
    ALTER TABLE invoices.billing_invoices DROP CONSTRAINT billing_invoices_status_check;
  END IF;

  ALTER TABLE invoices.billing_invoices
    ADD CONSTRAINT billing_invoices_status_check
    CHECK (status IN ('draft','issued','partially_paid','paid','overdue','waived','cancelled'));
END $$;

-- ── invoice line items: typed kind (line / tax / charge) ──────────

ALTER TABLE invoices.billing_invoice_items
  ADD COLUMN IF NOT EXISTS kind     varchar(16) NOT NULL DEFAULT 'line',
  ADD COLUMN IF NOT EXISTS quantity bigint      NOT NULL DEFAULT 1;

-- ── maker-checker: approval workflow for issue / cancel ───────────

CREATE TABLE IF NOT EXISTS invoices.billing_invoice_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  invoice_id    uuid NOT NULL,
  action        varchar(16) NOT NULL CHECK (action IN ('issue','cancel')),
  status        varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  amount_minor  bigint NOT NULL DEFAULT 0,
  requested_by  uuid NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_approvals_invoice
  ON invoices.billing_invoice_approvals(invoice_id);
-- At most one open request per invoice+action (a second request while one is
-- pending is a no-op/conflict, not a duplicate row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invoice_approvals_open
  ON invoices.billing_invoice_approvals(invoice_id, action)
  WHERE status = 'pending';

-- ── payments: receipt against a bill ──────────────────────────────

ALTER TABLE payments.billing_payments
  ADD COLUMN IF NOT EXISTS receipt_no  text,
  ADD COLUMN IF NOT EXISTS reference   text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice
  ON payments.billing_payments(invoice_id);
-- One settled receipt per command id is already guaranteed by the PK; the
-- partial unique below makes receipt_no unique per tenant when assigned.
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payments_receipt_no
  ON payments.billing_payments(tenant_id, receipt_no)
  WHERE receipt_no IS NOT NULL;
