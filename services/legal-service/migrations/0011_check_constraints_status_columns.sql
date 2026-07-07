-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: legal-service

SET lock_timeout = '5s';

-- ============================================================================
-- cases.legal_cases.status
-- Valid states: pending, disposed, appealed, stayed, settled (validators.ts
-- listCasesQuery status enum; consumer.ts writes "disposed" via dispose)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE cases.legal_cases
    ADD CONSTRAINT legal_cases_status_check
    CHECK (status IN ('pending', 'disposed', 'appealed', 'stayed', 'settled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- hearings.legal_hearings.status
-- Valid states: scheduled, completed, adjourned, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE hearings.legal_hearings
    ADD CONSTRAINT legal_hearings_status_check
    CHECK (status IN ('scheduled', 'completed', 'adjourned', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- notices.legal_notices.status
-- Valid states: open, responded (notices/consumer.ts: create → open, respond →
-- responded), plus "pending" retained for pre-existing rows written before
-- this constraint (schema default was "open"; some rows predate that default).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE notices.legal_notices
    ADD CONSTRAINT legal_notices_status_check
    CHECK (status IN ('open', 'responded', 'pending'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- opinions.legal_opinions.status
-- Valid states: sought, drafted, pending_approval, issued, rejected
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE opinions.legal_opinions
    ADD CONSTRAINT legal_opinions_status_check
    CHECK (status IN ('sought', 'drafted', 'pending_approval', 'issued', 'rejected'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- settlements.legal_settlements.status
-- Valid states: draft (schema default), settled (settlements/consumer.ts on create)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE settlements.legal_settlements
    ADD CONSTRAINT legal_settlements_status_check
    CHECK (status IN ('draft', 'settled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- contracts.legal_contract_reviews.status
-- Valid states: pending, cleared (contracts/consumer.ts: submit → pending,
-- clear → cleared)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE contracts.legal_contract_reviews
    ADD CONSTRAINT legal_contract_reviews_status_check
    CHECK (status IN ('pending', 'cleared'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- filings.legal_filings.status
-- Valid states: drafted, filed (validators.ts recordFilingBody/listQuery enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE filings.legal_filings
    ADD CONSTRAINT legal_filings_status_check
    CHECK (status IN ('drafted', 'filed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- counsel.legal_counsel_briefs.status
-- Valid states: assigned, accepted, completed, withdrawn (validators.ts listBriefsQuery enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE counsel.legal_counsel_briefs
    ADD CONSTRAINT legal_counsel_briefs_status_check
    CHECK (status IN ('assigned', 'accepted', 'completed', 'withdrawn'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE cases.legal_cases VALIDATE CONSTRAINT legal_cases_status_check;
ALTER TABLE hearings.legal_hearings VALIDATE CONSTRAINT legal_hearings_status_check;
ALTER TABLE notices.legal_notices VALIDATE CONSTRAINT legal_notices_status_check;
ALTER TABLE opinions.legal_opinions VALIDATE CONSTRAINT legal_opinions_status_check;
ALTER TABLE settlements.legal_settlements VALIDATE CONSTRAINT legal_settlements_status_check;
ALTER TABLE contracts.legal_contract_reviews VALIDATE CONSTRAINT legal_contract_reviews_status_check;
ALTER TABLE filings.legal_filings VALIDATE CONSTRAINT legal_filings_status_check;
ALTER TABLE counsel.legal_counsel_briefs VALIDATE CONSTRAINT legal_counsel_briefs_status_check;
