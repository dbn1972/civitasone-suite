-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: helpdesk-service

SET lock_timeout = '5s';

-- ============================================================================
-- helpdesk.tickets.status
-- Valid states: open, in_progress, assigned, resolved, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE helpdesk.tickets
    ADD CONSTRAINT tickets_status_check
    CHECK (status IN ('open', 'in_progress', 'assigned', 'resolved', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- helpdesk.tickets.priority
-- Valid values: Low, Medium, High, Critical
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE helpdesk.tickets
    ADD CONSTRAINT tickets_priority_check
    CHECK (priority IN ('Low', 'Medium', 'High', 'Critical'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE helpdesk.tickets VALIDATE CONSTRAINT tickets_status_check;
ALTER TABLE helpdesk.tickets VALIDATE CONSTRAINT tickets_priority_check;
