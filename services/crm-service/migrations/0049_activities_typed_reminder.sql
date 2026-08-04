-- Purpose: AC-001 typed activities + reminders.
--   * Widen crm.activities.type CHECK to add 'appointment' and 'reminder' to the
--     existing set {call,meeting,email,task,note,complaint,comm_delivery}. Additive:
--     no legacy row is invalidated (every prior value stays permitted). 'appointment'
--     (11) and 'reminder' (8) fit the varchar(16) column.
--   * Add remind_at (when a reminder-type activity should fire) and location (venue
--     for meetings/appointments). Both nullable — existing rows need no backfill.
-- Rollback: ALTER TABLE crm.activities DROP CONSTRAINT IF EXISTS activities_type_check;
--           ALTER TABLE crm.activities ADD CONSTRAINT activities_type_check
--             CHECK (type IN ('call','meeting','email','task','note','complaint','comm_delivery')) NOT VALID;
--           ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_type_check;
--           ALTER TABLE crm.activities DROP COLUMN IF EXISTS remind_at, DROP COLUMN IF EXISTS location;
-- Affected services: crm-service (activities module)

SET lock_timeout = '5s';

ALTER TABLE crm.activities
  ADD COLUMN IF NOT EXISTS remind_at timestamptz,
  ADD COLUMN IF NOT EXISTS location text;

DO $$ BEGIN
  ALTER TABLE crm.activities DROP CONSTRAINT IF EXISTS activities_type_check;
  ALTER TABLE crm.activities
    ADD CONSTRAINT activities_type_check
    CHECK (type IN ('call','meeting','email','task','note','complaint','comm_delivery','appointment','reminder'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE crm.activities VALIDATE CONSTRAINT activities_type_check;

-- Reminder scan support: reminders that have not yet fired, ordered by when.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_remind_at
  ON crm.activities(tenant_id, remind_at) WHERE remind_at IS NOT NULL;
