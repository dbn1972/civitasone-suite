-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0007_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- ============================================================================
-- helpdesk.tickets.source
-- Valid states: telephony, crm (source: topics.ts SOURCE constant; column is
-- nullable — tickets created directly via the API have source = NULL, only
-- tickets auto-opened from a foreign producer event carry a source tag)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE helpdesk.tickets
    ADD CONSTRAINT tickets_source_check
    CHECK (source IS NULL OR source IN ('telephony', 'crm'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE helpdesk.tickets VALIDATE CONSTRAINT tickets_source_check;
