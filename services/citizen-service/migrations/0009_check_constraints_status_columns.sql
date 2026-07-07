-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: citizen-service

SET lock_timeout = '5s';

-- ============================================================================
-- grievance.citizen_grievances.status
-- Valid states: registered, assigned, in_progress, resolved, closed, escalated, reopened
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE grievance.citizen_grievances
    ADD CONSTRAINT citizen_grievances_status_check
    CHECK (status IN ('registered', 'assigned', 'in_progress', 'resolved', 'closed', 'escalated', 'reopened'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- grievance.citizen_escalations.status
-- Valid states: open, acknowledged, resolved, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE grievance.citizen_escalations
    ADD CONSTRAINT citizen_escalations_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rti.citizen_rti_requests.status
-- Valid states: filed, acknowledged, responded, rejected, appealed, closed, transferred
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rti.citizen_rti_requests
    ADD CONSTRAINT citizen_rti_requests_status_check
    CHECK (status IN ('filed', 'acknowledged', 'responded', 'rejected', 'appealed', 'closed', 'transferred'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rti.citizen_rti_appeals.status
-- Valid states: filed, under_review, decided, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rti.citizen_rti_appeals
    ADD CONSTRAINT citizen_rti_appeals_status_check
    CHECK (status IN ('filed', 'under_review', 'decided', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- application.citizen_applications.status
-- Valid states: submitted, under_review, pending_docs, approved, rejected, issued, completed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE application.citizen_applications
    ADD CONSTRAINT citizen_applications_status_check
    CHECK (status IN ('submitted', 'under_review', 'pending_docs', 'approved', 'rejected', 'issued', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- helpdesk.citizen_tickets.status
-- Valid states: open, in_progress, resolved, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE helpdesk.citizen_tickets
    ADD CONSTRAINT citizen_tickets_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE grievance.citizen_grievances VALIDATE CONSTRAINT citizen_grievances_status_check;
ALTER TABLE grievance.citizen_escalations VALIDATE CONSTRAINT citizen_escalations_status_check;
ALTER TABLE rti.citizen_rti_requests VALIDATE CONSTRAINT citizen_rti_requests_status_check;
ALTER TABLE rti.citizen_rti_appeals VALIDATE CONSTRAINT citizen_rti_appeals_status_check;
ALTER TABLE application.citizen_applications VALIDATE CONSTRAINT citizen_applications_status_check;
ALTER TABLE helpdesk.citizen_tickets VALIDATE CONSTRAINT citizen_tickets_status_check;
