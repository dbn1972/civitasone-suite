-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: grant-service

SET lock_timeout = '5s';

-- ============================================================================
-- application.grant_app_documents.doc_type
-- SKIPPED: no fixed enumeration exists in code. The column comment in
-- migration 0001_init.sql lists "identity | income_proof | photo | other" as
-- illustrative examples, but no zod validator, domain module, or consumer in
-- modules/application enforces a closed set (grantAppDocuments has no
-- insert/consumer call site with a literal docType in this codebase — the
-- column is populated from client-supplied values only). Constraining it here
-- risks rejecting legitimate document categories that were never codified.
-- Not constrained.
-- ============================================================================

-- ============================================================================
-- utilisation.grant_audit_paras.audit_type
-- Valid states: statutory, CAG, internal
-- (migration 0001_init.sql column definition already carries an unnamed inline
-- CHECK: audit_type IN ('statutory','CAG','internal'); re-asserted here as a
-- named, idempotent constraint for consistency with the rest of this migration)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE utilisation.grant_audit_paras
    ADD CONSTRAINT grant_audit_paras_audit_type_check
    CHECK (audit_type IN ('statutory', 'CAG', 'internal'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- beneficiary.grant_beneficiaries.type
-- Valid states: individual, institution, society, mission
-- (beneficiary/validators.ts createBeneficiaryBody.type enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE beneficiary.grant_beneficiaries
    ADD CONSTRAINT grant_beneficiaries_type_check
    CHECK (type IN ('individual', 'institution', 'society', 'mission'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE utilisation.grant_audit_paras VALIDATE CONSTRAINT grant_audit_paras_audit_type_check;
ALTER TABLE beneficiary.grant_beneficiaries VALIDATE CONSTRAINT grant_beneficiaries_type_check;
