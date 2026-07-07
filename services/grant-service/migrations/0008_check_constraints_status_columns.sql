-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: grant-service

SET lock_timeout = '5s';

-- ============================================================================
-- scheme.grant_schemes.status
-- Valid states: draft, active, closed, suspended
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE scheme.grant_schemes
    ADD CONSTRAINT grant_schemes_status_check
    CHECK (status IN ('draft', 'active', 'closed', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- application.grant_applications.status
-- Valid states: draft, submitted, under_review, approved, rejected, withdrawn
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE application.grant_applications
    ADD CONSTRAINT grant_applications_status_check
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- disbursement.grant_disbursements.status
-- A correctly-named, correctly-valued CHECK constraint
-- (grant_disbursements_status_check) already exists on this column from
-- migration 0006, covering the real set: initiated, completed, failed,
-- pending_approval, cancelled. Do NOT add a second CHECK with a different
-- vocabulary here — Postgres ANDs multiple CHECK constraints on the same
-- column and a mismatched list would reject valid writes. Nothing to add.
-- ============================================================================

-- ============================================================================
-- disbursement.grant_installments.status
-- Valid states: pending, disbursed (disbursement/consumer.ts: create → pending,
-- initiate_disbursement → disbursed)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE disbursement.grant_installments
    ADD CONSTRAINT grant_installments_status_check
    CHECK (status IN ('pending', 'disbursed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.grant_uc_statements.status
-- Valid states: submitted, verified, approved, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_uc_statements
    ADD CONSTRAINT grant_uc_statements_status_check
    CHECK (status IN ('submitted', 'verified', 'approved', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.grant_uc_statements.validation_status
-- Valid states: pending, validated, rejected (consumer.ts default "pending";
-- repo.ts updateValidation accepts "validated" | "rejected")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_uc_statements
    ADD CONSTRAINT grant_uc_statements_validation_status_check
    CHECK (validation_status IN ('pending', 'validated', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.grant_compliance_reports.status
-- Valid states: submitted (schema default; consumer.ts only ever writes "submitted")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_compliance_reports
    ADD CONSTRAINT grant_compliance_reports_status_check
    CHECK (status IN ('submitted'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.grant_uc_validations.status
-- Valid states: validated, rejected (utilisation/repo.ts signature)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_uc_validations
    ADD CONSTRAINT grant_uc_validations_status_check
    CHECK (status IN ('validated', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- utilisation.grant_audit_paras.status
-- Valid states: open, responded, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_audit_paras
    ADD CONSTRAINT grant_audit_paras_status_check
    CHECK (status IN ('open', 'responded', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- beneficiary.grant_beneficiaries.status
-- Valid states: active, inactive, suspended, blocked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE beneficiary.grant_beneficiaries
    ADD CONSTRAINT grant_beneficiaries_status_check
    CHECK (status IN ('active', 'inactive', 'suspended', 'blocked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- beneficiary.grant_aadhaar_links.status
-- Valid states: active (schema default; consumer.ts only ever writes "active")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE beneficiary.grant_aadhaar_links
    ADD CONSTRAINT grant_aadhaar_links_status_check
    CHECK (status IN ('active'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- beneficiary.grant_bank_accounts.status
-- Valid states: active, inactive, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE beneficiary.grant_bank_accounts
    ADD CONSTRAINT grant_bank_accounts_status_check
    CHECK (status IN ('active', 'inactive', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE scheme.grant_schemes VALIDATE CONSTRAINT grant_schemes_status_check;
ALTER TABLE application.grant_applications VALIDATE CONSTRAINT grant_applications_status_check;
ALTER TABLE disbursement.grant_installments VALIDATE CONSTRAINT grant_installments_status_check;
ALTER TABLE utilisation.grant_uc_statements VALIDATE CONSTRAINT grant_uc_statements_status_check;
ALTER TABLE utilisation.grant_uc_statements VALIDATE CONSTRAINT grant_uc_statements_validation_status_check;
ALTER TABLE utilisation.grant_compliance_reports VALIDATE CONSTRAINT grant_compliance_reports_status_check;
ALTER TABLE utilisation.grant_uc_validations VALIDATE CONSTRAINT grant_uc_validations_status_check;
ALTER TABLE utilisation.grant_audit_paras VALIDATE CONSTRAINT grant_audit_paras_status_check;
ALTER TABLE beneficiary.grant_beneficiaries VALIDATE CONSTRAINT grant_beneficiaries_status_check;
ALTER TABLE beneficiary.grant_aadhaar_links VALIDATE CONSTRAINT grant_aadhaar_links_status_check;
ALTER TABLE beneficiary.grant_bank_accounts VALIDATE CONSTRAINT grant_bank_accounts_status_check;
