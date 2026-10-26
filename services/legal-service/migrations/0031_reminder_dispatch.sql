-- Migration: 0031_reminder_dispatch
-- Purpose: GAP-LEGAL-HEARINGS-05 (owner decision #8). A 5-minute dispatcher sweep
--   sends due case reminders through notification-service. The recipient is the
--   case's assigned officer(s) (new cases.legal_cases.assigned_officer_ids); the
--   reminder's creator is cc'd. reminders.legal_reminders.sent_at records when the
--   sweep dispatched it (sent flips true in the same transaction as the outbox
--   notification rows, so dispatch is exactly-once).
--   The sweep discovers due reminders across tenants through the existing
--   SELECT-only BYPASSRLS legal_scanner role (0028); every write then runs under
--   the reminder's own tenant context as legal_svc, so FORCE RLS re-checks it.
-- Rollback:
--   REVOKE SELECT ON reminders.legal_reminders FROM legal_scanner;
--   REVOKE USAGE ON SCHEMA reminders FROM legal_scanner;
--   DROP INDEX IF EXISTS reminders.idx_legal_reminders_due;
--   ALTER TABLE reminders.legal_reminders DROP COLUMN IF EXISTS sent_at;
--   ALTER TABLE cases.legal_cases DROP COLUMN IF EXISTS assigned_officer_ids;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE cases.legal_cases
  ADD COLUMN IF NOT EXISTS assigned_officer_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE reminders.legal_reminders
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- Partial index: the sweep only ever looks at unsent reminders ordered by due time.
CREATE INDEX IF NOT EXISTS idx_legal_reminders_due
  ON reminders.legal_reminders (remind_at) WHERE sent = FALSE;

-- Cross-tenant discovery for the sweep: SELECT only, one table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'legal_scanner') THEN
    GRANT USAGE ON SCHEMA reminders TO legal_scanner;
    GRANT SELECT ON reminders.legal_reminders TO legal_scanner;
  END IF;
END
$$;
