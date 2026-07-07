-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0009_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: billing-service

SET lock_timeout = '5s';

-- ============================================================================
-- invoices.billing_invoice_items.kind
-- Valid states: line, tax, charge (domain.ts LineKind type; consumer.ts
-- defaults to "line" when omitted; computeTotals branches on "tax"/"charge"
-- vs anything else → "line" is the implicit catch-all)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE invoices.billing_invoice_items
    ADD CONSTRAINT billing_invoice_items_kind_check
    CHECK (kind IN ('line', 'tax', 'charge'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- invoices.billing_invoice_approvals.action
-- Valid states: issue, cancel (consumer.ts creates approval rows with action
-- "issue" for bill issuance and "cancel" for cancellation; the checker
-- decision flow branches on ap.action === "issue")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE invoices.billing_invoice_approvals
    ADD CONSTRAINT billing_invoice_approvals_action_check
    CHECK (action IN ('issue', 'cancel'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: invoices.billing_invoices.status — already constrained by
-- billing_invoices_status_check (added in 0002_billing_lifecycle.sql) covering
-- ('draft','issued','partially_paid','paid','overdue','waived','cancelled').
-- matches InvoiceStatus union in domain.ts. Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: subscriptions.billing_subscriptions.status — already constrained by
-- billing_subscriptions_status_check (0009) covering
-- ('trial','active','past_due','cancelled','suspended'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: payments.billing_payments.status — already constrained by
-- billing_payments_status_check (0009) covering ('pending','completed').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: payments.billing_gateway_txns.status — already constrained by
-- billing_gateway_txns_status_check (0009) covering
-- ('initiated','authorized','captured','failed','refunded'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: payments.billing_dunning_attempts.status — already constrained by
-- billing_dunning_attempts_status_check (0009) covering
-- ('pending','retrying','exhausted','recovered'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: einvoice.billing_einvoice_requests.status — already constrained by
-- billing_einvoice_requests_status_check (0009) covering
-- ('pending','generated','failed','cancelled'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: invoices.billing_invoice_approvals.status — already constrained by
-- billing_invoice_approvals_status_check (0009) covering
-- ('pending','approved','rejected'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE invoices.billing_invoice_items VALIDATE CONSTRAINT billing_invoice_items_kind_check;
ALTER TABLE invoices.billing_invoice_approvals VALIDATE CONSTRAINT billing_invoice_approvals_action_check;
