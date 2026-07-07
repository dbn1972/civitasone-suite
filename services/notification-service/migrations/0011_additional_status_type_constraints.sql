-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: notification-service

SET lock_timeout = '5s';

-- ============================================================================
-- templates.prefs.event_type
-- SKIPPED: event_type is a free-form varchar(128) mirroring arbitrary
-- cross-service topic names, not a closed catalog owned by this service.
-- validators.ts (setPrefsBody) only requires z.string().min(1).max(128); the
-- notification-service topics.ts CONSUMED_EVENTS list (hrms.leave.approved,
-- finance.sanction.approved, procurement.grn.accepted, helpdesk.ticket.created,
-- citizen.request.created, audit.para.issued, etc.) is a *sample* of events
-- consumed today, but templates/domain.ts PrefView.eventType and setPrefsBody
-- accept ANY event string a tenant admin wants to configure preferences for
-- (test fixtures use "finance.payment.released", "login", "alert",
-- "order.created", "optout.evt" — clearly illustrative, not exhaustive) and
-- the catalog grows as new producer services are onboarded. No bounded set
-- could be determined without guessing. Not constrained.
-- ============================================================================

-- ============================================================================
-- alerts.alert_events.status
-- Valid states: pending (schema default in migration 0002; no route,
-- consumer, or repo function in this service ever inserts into or updates
-- alerts.alert_events — the table is defined in schema.ts/migration 0002 but
-- has no write path yet, so "pending" is the only value that can exist).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE alerts.alert_events
    ADD CONSTRAINT alert_events_status_check
    CHECK (status IN ('pending'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE alerts.alert_events VALIDATE CONSTRAINT alert_events_status_check;
