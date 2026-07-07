-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: legal-service

SET lock_timeout = '5s';

-- ============================================================================
-- hearings.legal_orders.order_type
-- SKIPPED: order_type is a free-form varchar(32) with no zod enum or fixed
-- catalog. validators.ts (recordOrderBody) only requires z.string().min(1).max(32);
-- consumer.ts writes through orderType verbatim with no branching on value;
-- test fixtures use "interim" but that is illustrative, not exhaustive (courts
-- issue many order types — interim, final, stay, dismissal, remand, etc.).
-- No bounded set could be determined without guessing. Not constrained.
-- ============================================================================

-- ============================================================================
-- hearings.legal_opinions.status
-- Valid states: pending, draft, issued, revised (hearings/queries.ts
-- mapHearingStatus-equivalent whitelist for this legacy table: the only
-- values queries.ts recognizes are pending/draft/issued/revised, defaulting
-- unknown values back to "pending". Note: this hearings.legal_opinions table
-- is a legacy/orphan table — the active opinions domain lives in
-- opinions.legal_opinions (already constrained via legal_opinions_status_check
-- in migration 0011, in the "opinions" schema, a different table).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE hearings.legal_opinions
    ADD CONSTRAINT legal_opinions_hearings_status_check
    CHECK (status IN ('pending', 'draft', 'issued', 'revised'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- contracts.legal_clearances.clearance_type
-- SKIPPED: clearance_type is a free-form varchar(32) with no zod enum.
-- validators.ts (clearReviewBody) only requires z.string().min(1).max(32);
-- consumer.ts passes clearanceType through verbatim. Test fixtures use
-- "legal_opinion" and "re-attempt" as arbitrary example values, not an
-- exhaustive enumeration. No bounded set could be determined. Not constrained.
-- ============================================================================

-- ============================================================================
-- counsel.legal_counsel_briefs.counsel_type
-- Valid states: advocate, senior_advocate, counsel, law_officer
-- (counsel/validators.ts createBriefBody: counselType z.enum([...]))
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE counsel.legal_counsel_briefs
    ADD CONSTRAINT legal_counsel_briefs_counsel_type_check
    CHECK (counsel_type IN ('advocate', 'senior_advocate', 'counsel', 'law_officer'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- filings.legal_filings.filing_type
-- Valid states: affidavit, petition, reply, rejoinder, written_statement,
-- application, appeal (filings/validators.ts recordFilingBody: filingType
-- z.enum([...]))
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE filings.legal_filings
    ADD CONSTRAINT legal_filings_filing_type_check
    CHECK (filing_type IN ('affidavit', 'petition', 'reply', 'rejoinder', 'written_statement', 'application', 'appeal'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE hearings.legal_opinions VALIDATE CONSTRAINT legal_opinions_hearings_status_check;
ALTER TABLE counsel.legal_counsel_briefs VALIDATE CONSTRAINT legal_counsel_briefs_counsel_type_check;
ALTER TABLE filings.legal_filings VALIDATE CONSTRAINT legal_filings_filing_type_check;
