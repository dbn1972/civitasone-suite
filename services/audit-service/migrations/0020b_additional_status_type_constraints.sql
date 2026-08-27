-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0016_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: audit-service

SET lock_timeout = '5s';

-- ============================================================================
-- events.events.type
-- SKIPPED: this is the append-only CERT-In audit sink (schema.ts doc comment:
-- "Append-only audit event log... no DELETE or UPDATE routes exist"). It is
-- populated via audit.event.ingest / audit.event.record, the audit trail
-- topic consumed from every one of the other 32 microservices in the suite
-- (269 call sites across services publish to "audit.event.record" with
-- free-form action/resourceType values, e.g. "citizen_application:submit",
-- "asset:create", "grievance:resolve", etc. — msg.type is passed straight
-- through by events/consumer.ts with no local enumeration or validation).
-- There is no closed, bounded set of "type" values — it mirrors whatever
-- action names any service chooses to audit, and that vocabulary grows as
-- services add new commands. No CHECK constraint added — would require
-- guessing at (and constantly maintaining) a cross-service action catalog
-- that audit-service does not own.
-- ============================================================================

-- ============================================================================
-- para.audit_para_status_history.from_status
-- para.audit_para_status_history.to_status
-- Valid states: draft, issued, replied, settled, pending_recovery, closed
-- (source: reuses para.audit_paras.status vocabulary — see
-- audit_paras_status_check in 0016_check_constraints_status_columns.sql.
-- from_status is nullable — history rows created on first transition into
-- "draft" may have no prior state — so NULL is explicitly allowed; to_status
-- is NOT NULL per schema.ts.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE para.audit_para_status_history
    ADD CONSTRAINT audit_para_status_history_from_status_check
    CHECK (from_status IS NULL OR from_status IN ('draft', 'issued', 'replied', 'settled', 'pending_recovery', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE para.audit_para_status_history
    ADD CONSTRAINT audit_para_status_history_to_status_check
    CHECK (to_status IN ('draft', 'issued', 'replied', 'settled', 'pending_recovery', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- vigilance.vigilance_cases.inquiry_status
-- Valid states: preliminary_enquiry, under_investigation, charge_sheet_issued,
-- inquiry_complete (source: packages/schemas/src/web.ts
-- VigilanceCaseSummarySchema.inquiryStatus enum, mirrored in
-- packages/types/src/index.ts and consumed by
-- apps/web/.../audit/vigilance/VigilanceTable.tsx and loaders.ts; schema.ts
-- default "preliminary_enquiry")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE vigilance.vigilance_cases
    ADD CONSTRAINT vigilance_cases_inquiry_status_check
    CHECK (inquiry_status IN ('preliminary_enquiry', 'under_investigation', 'charge_sheet_issued', 'inquiry_complete'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- investigation.investigations.status
-- Valid states: in_progress, findings_submitted, closed (source:
-- packages/schemas/src/web.ts InvestigationSummarySchema.status enum,
-- mirrored in packages/types/src/index.ts; schema.ts default "in_progress")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE investigation.investigations
    ADD CONSTRAINT investigations_status_check
    CHECK (status IN ('in_progress', 'findings_submitted', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE para.audit_para_status_history VALIDATE CONSTRAINT audit_para_status_history_from_status_check;
ALTER TABLE para.audit_para_status_history VALIDATE CONSTRAINT audit_para_status_history_to_status_check;
ALTER TABLE vigilance.vigilance_cases VALIDATE CONSTRAINT vigilance_cases_inquiry_status_check;
ALTER TABLE investigation.investigations VALIDATE CONSTRAINT investigations_status_check;
