-- Migration: 0030_reminders_schema_align
-- Purpose: GAP-LEGAL-HEARINGS-05. reminders.legal_reminders (0003) was created
--   with reminder_date/reminder_type/description/is_sent, but the Drizzle model
--   and the reminder-create consumer write remind_at/message/sent/created_by/
--   updated_at/updated_by/version. Every INSERT from the consumer (and every
--   SELECT * from GET /v1/legal/cases/:id/reminders) failed on a real database,
--   so a reminder accepted with 202 was silently never stored and never audited.
--   This adds the columns the model declares, back-fills them from the legacy
--   columns, and relaxes the legacy NOT NULL so new inserts succeed.
-- Rollback:
--   ALTER TABLE reminders.legal_reminders
--     DROP COLUMN IF EXISTS remind_at, DROP COLUMN IF EXISTS message, DROP COLUMN IF EXISTS sent,
--     DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_at,
--     DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS version;
--   ALTER TABLE reminders.legal_reminders ALTER COLUMN reminder_date SET NOT NULL;
-- Affected services: legal-service

SET lock_timeout = '5s';

ALTER TABLE reminders.legal_reminders
  ADD COLUMN IF NOT EXISTS remind_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS message    TEXT,
  ADD COLUMN IF NOT EXISTS sent       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS version    INTEGER NOT NULL DEFAULT 1;

-- FORCE RLS applies to the table owner, and a migration has no tenant GUC, so
-- the cross-tenant back-fill would match 0 rows and SET NOT NULL below would
-- abort on any legacy row. Lift FORCE for the one-off back-fill, then restore
-- it (as 0027/0029 do).
ALTER TABLE reminders.legal_reminders NO FORCE ROW LEVEL SECURITY;

-- Back-fill any legacy rows. Rows predating this migration have no recorded
-- author, so they get the nil UUID as an explicit "unknown" marker.
UPDATE reminders.legal_reminders
   SET remind_at  = COALESCE(remind_at, reminder_date::timestamptz),
       message    = COALESCE(message, description, reminder_type),
       sent       = is_sent,
       created_by = COALESCE(created_by, '00000000-0000-0000-0000-000000000000'),
       updated_by = COALESCE(updated_by, '00000000-0000-0000-0000-000000000000')
 WHERE remind_at IS NULL OR message IS NULL OR created_by IS NULL OR updated_by IS NULL;

ALTER TABLE reminders.legal_reminders FORCE ROW LEVEL SECURITY;

ALTER TABLE reminders.legal_reminders
  ALTER COLUMN remind_at  SET NOT NULL,
  ALTER COLUMN message    SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ALTER COLUMN updated_by SET NOT NULL,
  ALTER COLUMN reminder_date DROP NOT NULL;
