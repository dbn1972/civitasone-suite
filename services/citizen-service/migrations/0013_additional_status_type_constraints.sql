-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0009_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: citizen-service

SET lock_timeout = '5s';

-- ============================================================================
-- application.citizen_app_documents.doc_type
-- SKIPPED: free-form document category chosen per-service (e.g. Aadhaar,
-- income certificate, domicile, caste certificate, etc.). validators.ts
-- docUploadBody.docType only enforces safeText({max:64}) — no enum anywhere
-- in domain.ts, consumer.ts, routes.ts, or the portal module's required-docs
-- list (which is itself dynamic per service definition, not a fixed catalog
-- in this codebase). No CHECK constraint added — would require guessing at
-- the open-ended set of citizen-service document categories.
-- ============================================================================

-- ============================================================================
-- application.citizen_status_history.from_status
-- application.citizen_status_history.to_status
-- Valid states: submitted, under_review, pending_docs, approved, rejected,
-- issued, completed, cancelled (source: reuses
-- application.citizen_applications.status vocabulary — see
-- citizen_applications_status_check in
-- 0009_check_constraints_status_columns.sql. from_status is nullable —
-- application/consumer.ts inserts the first history row with
-- fromStatus: null on initial submission — so NULL is explicitly allowed;
-- to_status is NOT NULL per schema.ts.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE application.citizen_status_history
    ADD CONSTRAINT citizen_status_history_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('submitted', 'under_review', 'pending_docs', 'approved', 'rejected', 'issued', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE application.citizen_status_history
    ADD CONSTRAINT citizen_status_history_to_status_check
    CHECK (to_status IN ('submitted', 'under_review', 'pending_docs', 'approved', 'rejected', 'issued', 'completed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- grievance.citizen_grievance_actions.action_type
-- SKIPPED: free-form officer-entered action label. validators.ts
-- grievanceActionBody.actionType only enforces safeText({max:64}). While
-- grievance/consumer.ts emits several literal values on system-generated
-- actions (auto_assign, assign, resolve, escalate, reopen, auto_escalate),
-- the officer-facing POST /v1/citizen/grievances/:id/actions endpoint
-- accepts any free-text actionType from the caller (grievanceActionBody has
-- no enum), so the column is not actually bounded to those literals in
-- practice. No CHECK constraint added — would incorrectly reject legitimate
-- officer-entered action types.
-- ============================================================================

-- ============================================================================
-- rti.citizen_rti_appeals.appeal_type
-- Valid states: first, cic (source: modules/rti/validators.ts
-- appealRtiBody.appealType enum; schema.ts default "first")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rti.citizen_rti_appeals
    ADD CONSTRAINT citizen_rti_appeals_appeal_type_check
    CHECK (appeal_type IN ('first', 'cic'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- helpdesk.citizen_tickets.ticket_type
-- SKIPPED: no validator, route, domain, or consumer in the helpdesk module
-- ever sets or reads ticketType — createTicketBody (validators.ts) has no
-- ticketType field, and helpdesk/consumer.ts's insertTicket call omits it
-- entirely, so the column silently keeps its schema default ("grievance")
-- for every row today. There is no enumeration in code to source valid
-- values from beyond that single observed default. No CHECK constraint
-- added — would require guessing at a value set the application does not
-- yet exercise.
-- ============================================================================

-- ============================================================================
-- analytics.citizen_sla_configs.service_type
-- analytics.citizen_delivery_metrics.service_type
-- SKIPPED: free-form key shared with application.citizen_applications'
-- caller-supplied serviceType (submitApplicationBody.serviceType is
-- safeText({max:128}), not an enum) and used as a lookup key in
-- analytics/repo.ts findSlaConfig(tenantId, serviceType). One fixed literal
-- ("grievance") is used in aggregateGrievancesByDepartment, but the SLA
-- config table is designed to hold one row per citizen-defined service
-- (e.g. "birth_certificate", "trade_license", ...), which is not a bounded
-- set in this codebase. No CHECK constraint added — would incorrectly
-- reject legitimate tenant-configured service types.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE application.citizen_status_history VALIDATE CONSTRAINT citizen_status_history_from_status_check;
ALTER TABLE application.citizen_status_history VALIDATE CONSTRAINT citizen_status_history_to_status_check;
ALTER TABLE rti.citizen_rti_appeals VALIDATE CONSTRAINT citizen_rti_appeals_appeal_type_check;
