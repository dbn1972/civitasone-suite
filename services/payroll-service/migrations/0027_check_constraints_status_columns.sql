-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: payroll-service

SET lock_timeout = '5s';

-- ============================================================================
-- payroll.pay_groups.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.pay_groups
    ADD CONSTRAINT pay_groups_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.payroll_structures.status
-- Valid states: active (schema default; consumer.ts only ever writes "active")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_structures
    ADD CONSTRAINT payroll_structures_status_check
    CHECK (status IN ('active'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.payroll_pensioners.status
-- Valid states: active (schema default; no transition path implemented yet)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_pensioners
    ADD CONSTRAINT payroll_pensioners_status_check
    CHECK (status IN ('active'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.payroll_runs.status
-- Valid states: draft, processing, computed, approved, disbursed, paid, cancelled, failed
-- Note: 0001 already has inline CHECK; this is additive for extra states
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_runs
    ADD CONSTRAINT payroll_runs_status_check_extended
    CHECK (status IN ('draft', 'processing', 'computed', 'approved', 'disbursed', 'paid', 'cancelled', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.payroll_slips.status
-- Valid states: computed, approved, paid, held
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_slips
    ADD CONSTRAINT payroll_slips_status_check
    CHECK (status IN ('computed', 'approved', 'paid', 'held'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.payroll_tax_declarations.status
-- Valid states: draft, submitted, verified, approved
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_tax_declarations
    ADD CONSTRAINT payroll_tax_declarations_status_check
    CHECK (status IN ('draft', 'submitted', 'verified', 'approved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.fnf_settlements.status
-- Valid states: draft, computed, approved, paid, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.fnf_settlements
    ADD CONSTRAINT fnf_settlements_status_check
    CHECK (status IN ('draft', 'computed', 'approved', 'paid', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.form16_bulk_jobs.status
-- Valid states: pending, generating, completed, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.form16_bulk_jobs
    ADD CONSTRAINT form16_bulk_jobs_status_check
    CHECK (status IN ('pending', 'generating', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- statutory.payroll_gratuity.status
-- Valid states: computed, approved, paid
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE statutory.payroll_gratuity
    ADD CONSTRAINT payroll_gratuity_status_check
    CHECK (status IN ('computed', 'approved', 'paid'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- loans.payroll_loans.status
-- Valid states: applied, approved, disbursed, repaying, closed, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE loans.payroll_loans
    ADD CONSTRAINT payroll_loans_status_check
    CHECK (status IN ('applied', 'approved', 'disbursed', 'repaying', 'closed', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- loans.payroll_loan_repayments.status
-- Valid states: pending, deducted, waived, overdue
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE loans.payroll_loan_repayments
    ADD CONSTRAINT payroll_loan_repayments_status_check
    CHECK (status IN ('pending', 'deducted', 'waived', 'overdue'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- statutory.payroll_tds_challan.status
-- Valid states: ingested, reconciled, verified, submitted, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE statutory.payroll_tds_challan
    ADD CONSTRAINT payroll_tds_challan_status_check
    CHECK (status IN ('ingested', 'reconciled', 'verified', 'submitted', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE payroll.pay_groups VALIDATE CONSTRAINT pay_groups_status_check;
ALTER TABLE payroll.payroll_structures VALIDATE CONSTRAINT payroll_structures_status_check;
ALTER TABLE payroll.payroll_pensioners VALIDATE CONSTRAINT payroll_pensioners_status_check;
ALTER TABLE payroll.payroll_runs VALIDATE CONSTRAINT payroll_runs_status_check_extended;
ALTER TABLE payroll.payroll_slips VALIDATE CONSTRAINT payroll_slips_status_check;
ALTER TABLE payroll.payroll_tax_declarations VALIDATE CONSTRAINT payroll_tax_declarations_status_check;
ALTER TABLE payroll.fnf_settlements VALIDATE CONSTRAINT fnf_settlements_status_check;
ALTER TABLE payroll.form16_bulk_jobs VALIDATE CONSTRAINT form16_bulk_jobs_status_check;
ALTER TABLE statutory.payroll_gratuity VALIDATE CONSTRAINT payroll_gratuity_status_check;
ALTER TABLE loans.payroll_loans VALIDATE CONSTRAINT payroll_loans_status_check;
ALTER TABLE loans.payroll_loan_repayments VALIDATE CONSTRAINT payroll_loan_repayments_status_check;
ALTER TABLE statutory.payroll_tds_challan VALIDATE CONSTRAINT payroll_tds_challan_status_check;
