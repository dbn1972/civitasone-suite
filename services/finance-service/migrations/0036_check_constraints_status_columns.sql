-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: finance-service

SET lock_timeout = '5s';

-- ============================================================================
-- payments.finance_bills.status
-- Valid states: pending, passed, paid, rejected, on_hold, under_review, draft
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_bills
    ADD CONSTRAINT finance_bills_status_check
    CHECK (status IN ('draft', 'pending', 'passed', 'paid', 'rejected', 'on_hold', 'under_review'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_bills.stage
-- Valid stages: section, audit, drawing, paid
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_bills
    ADD CONSTRAINT finance_bills_stage_check
    CHECK (stage IN ('section', 'audit', 'drawing', 'paid'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_payments.status
-- Valid states: pending, initiated, released, cancelled, pending_approval, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_payments
    ADD CONSTRAINT finance_payments_status_check
    CHECK (status IN ('pending', 'initiated', 'released', 'cancelled', 'pending_approval', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_pfms.status
-- Valid states: pending, submitted, accepted, rejected, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_pfms
    ADD CONSTRAINT finance_pfms_status_check
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_advances.status
-- Valid states: active, adjusted, overdue, closed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_advances
    ADD CONSTRAINT finance_advances_status_check
    CHECK (status IN ('active', 'adjusted', 'overdue', 'closed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.finance_uc.status
-- Valid states: pending, submitted, verified, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.finance_uc
    ADD CONSTRAINT finance_uc_status_check
    CHECK (status IN ('pending', 'submitted', 'verified', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gl.finance_journals.status
-- Valid states: draft, posted, reversed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_journals
    ADD CONSTRAINT finance_journals_status_check
    CHECK (status IN ('draft', 'posted', 'reversed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- budget.finance_sanctions.status
-- Valid states: draft, approved, exhausted, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE budget.finance_sanctions
    ADD CONSTRAINT finance_sanctions_status_check
    CHECK (status IN ('draft', 'approved', 'exhausted', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- budget.finance_schemes.status
-- Valid states: active, exhausted, cancelled, draft
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE budget.finance_schemes
    ADD CONSTRAINT finance_schemes_status_check
    CHECK (status IN ('draft', 'active', 'exhausted', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- budget.finance_demands.status
-- Valid states: draft, submitted, approved, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE budget.finance_demands
    ADD CONSTRAINT finance_demands_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- budget.finance_reappropriations.status
-- Valid states: pending_approval, approved, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE budget.finance_reappropriations
    ADD CONSTRAINT finance_reappropriations_status_check
    CHECK (status IN ('pending_approval', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_bank_statement.status
-- Valid states: imported, reconciled, partial
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_bank_statement
    ADD CONSTRAINT finance_bank_statement_status_check
    CHECK (status IN ('imported', 'reconciled', 'partial'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- gl.finance_period_close.status
-- Valid states: open, soft_close, hard_close (inline CHECK in 0005)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE gl.finance_period_close
    ADD CONSTRAINT finance_period_close_status_check
    CHECK (status IN ('open', 'soft_close', 'hard_close'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_challans.status
-- Valid states: pending, deposited, reconciled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_challans
    ADD CONSTRAINT finance_challans_status_check
    CHECK (status IN ('pending', 'deposited', 'reconciled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_deposits.status
-- Valid states: active, forfeited, refunded
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_deposits
    ADD CONSTRAINT finance_deposits_status_check
    CHECK (status IN ('active', 'forfeited', 'refunded'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_debt.status
-- Valid states: active, closed, defaulted, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_debt
    ADD CONSTRAINT finance_debt_status_check
    CHECK (status IN ('active', 'closed', 'defaulted', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_guarantees.status
-- Valid states: active, partially_released, fully_released, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_guarantees
    ADD CONSTRAINT finance_guarantees_status_check
    CHECK (status IN ('active', 'partially_released', 'fully_released', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- treasury.finance_instruments.status
-- Valid states: issued, presented, cleared, bounced, cancelled, stale (inline CHECK in 0017)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE treasury.finance_instruments
    ADD CONSTRAINT finance_instruments_status_check
    CHECK (status IN ('issued', 'presented', 'cleared', 'bounced', 'cancelled', 'stale'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- audit.finance_audit_paras.status
-- Valid states: open, responded, settled, escalated, dropped
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE audit.finance_audit_paras
    ADD CONSTRAINT finance_audit_paras_status_check
    CHECK (status IN ('open', 'responded', 'settled', 'escalated', 'dropped'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE payments.finance_bills VALIDATE CONSTRAINT finance_bills_status_check;
ALTER TABLE payments.finance_bills VALIDATE CONSTRAINT finance_bills_stage_check;
ALTER TABLE payments.finance_payments VALIDATE CONSTRAINT finance_payments_status_check;
ALTER TABLE payments.finance_pfms VALIDATE CONSTRAINT finance_pfms_status_check;
ALTER TABLE payments.finance_advances VALIDATE CONSTRAINT finance_advances_status_check;
ALTER TABLE payments.finance_uc VALIDATE CONSTRAINT finance_uc_status_check;
ALTER TABLE gl.finance_journals VALIDATE CONSTRAINT finance_journals_status_check;
ALTER TABLE budget.finance_sanctions VALIDATE CONSTRAINT finance_sanctions_status_check;
ALTER TABLE budget.finance_schemes VALIDATE CONSTRAINT finance_schemes_status_check;
ALTER TABLE budget.finance_demands VALIDATE CONSTRAINT finance_demands_status_check;
ALTER TABLE budget.finance_reappropriations VALIDATE CONSTRAINT finance_reappropriations_status_check;
ALTER TABLE treasury.finance_bank_statement VALIDATE CONSTRAINT finance_bank_statement_status_check;
ALTER TABLE gl.finance_period_close VALIDATE CONSTRAINT finance_period_close_status_check;
ALTER TABLE treasury.finance_challans VALIDATE CONSTRAINT finance_challans_status_check;
ALTER TABLE treasury.finance_deposits VALIDATE CONSTRAINT finance_deposits_status_check;
ALTER TABLE treasury.finance_debt VALIDATE CONSTRAINT finance_debt_status_check;
ALTER TABLE treasury.finance_guarantees VALIDATE CONSTRAINT finance_guarantees_status_check;
ALTER TABLE treasury.finance_instruments VALIDATE CONSTRAINT finance_instruments_status_check;
ALTER TABLE audit.finance_audit_paras VALIDATE CONSTRAINT finance_audit_paras_status_check;
