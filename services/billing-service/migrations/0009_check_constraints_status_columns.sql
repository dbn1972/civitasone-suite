-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: billing-service

SET lock_timeout = '5s';

-- ============================================================================
-- subscriptions.billing_subscriptions.status
-- Valid states: trial, active, past_due, cancelled, suspended
-- (inline CHECK in 0001 uses trial/active/suspended/cancelled; extended here)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE subscriptions.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_status_check
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- invoices.billing_invoice_approvals.status
-- Valid states: pending, approved, rejected (inline CHECK in 0002)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE invoices.billing_invoice_approvals
    ADD CONSTRAINT billing_invoice_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.billing_payments.status
-- Valid states: pending (default, pre-consumer), completed (set by consumer.ts
-- on successful capture). No refund/failed path writes this column today —
-- widen later if a refund workflow is added.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.billing_payments
    ADD CONSTRAINT billing_payments_status_check
    CHECK (status IN ('pending', 'completed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.billing_gateway_txns.status
-- Valid states: initiated, authorized, captured, failed, refunded
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.billing_gateway_txns
    ADD CONSTRAINT billing_gateway_txns_status_check
    CHECK (status IN ('initiated', 'authorized', 'captured', 'failed', 'refunded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.billing_dunning_attempts.status
-- Valid states: pending, retrying, exhausted, recovered (inline CHECK in 0004)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.billing_dunning_attempts
    ADD CONSTRAINT billing_dunning_attempts_status_check
    CHECK (status IN ('pending', 'retrying', 'exhausted', 'recovered'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- einvoice.billing_einvoice_requests.status
-- Valid states: pending, generated, failed, cancelled (inline CHECK in 0005)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE einvoice.billing_einvoice_requests
    ADD CONSTRAINT billing_einvoice_requests_status_check
    CHECK (status IN ('pending', 'generated', 'failed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE subscriptions.billing_subscriptions VALIDATE CONSTRAINT billing_subscriptions_status_check;
ALTER TABLE invoices.billing_invoice_approvals VALIDATE CONSTRAINT billing_invoice_approvals_status_check;
ALTER TABLE payments.billing_payments VALIDATE CONSTRAINT billing_payments_status_check;
ALTER TABLE payments.billing_gateway_txns VALIDATE CONSTRAINT billing_gateway_txns_status_check;
ALTER TABLE payments.billing_dunning_attempts VALIDATE CONSTRAINT billing_dunning_attempts_status_check;
ALTER TABLE einvoice.billing_einvoice_requests VALIDATE CONSTRAINT billing_einvoice_requests_status_check;
