-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: telephony-service

SET lock_timeout = '5s';

-- ============================================================================
-- telephony.calls.linked_ref_type
-- Valid values: grievance, helpdesk_ticket, citizen_request (source:
-- modules/calls/validators.ts linkCallBody.refType z.enum; confirmed as the
-- complete, enforced set by 400-rejection test coverage for an
-- out-of-enum value in tests/routes-coverage-full.test.ts)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE telephony.calls
    ADD CONSTRAINT calls_linked_ref_type_check
    CHECK (linked_ref_type IN ('grievance', 'helpdesk_ticket', 'citizen_request'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE telephony.calls VALIDATE CONSTRAINT calls_linked_ref_type_check;
