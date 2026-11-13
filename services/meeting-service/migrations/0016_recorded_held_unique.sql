-- Migration: 0016_recorded_held_unique.sql
-- Gap-fix wave (11 Nov 2026), HANDOFF 5 item 10. Additive and idempotent; safe to re-run.
--
-- POST /v1/meetings/record-held guards against recording the same meeting twice with a
-- check-then-insert, which two workers holding different idempotency keys can race. This adds the
-- backstop in the database:
--   1. meetings.recorded_held_at (nullable, no default, catalog-only): set only by the record-held
--      path. Every existing row stays NULL, so nothing existing is constrained.
--   2. a UNIQUE partial index over the identifying columns of record-held meetings:
--      (tenant, committee or none, title, scheduled_at), excluding cancelled ones (a cancelled
--      meeting may be recorded again, as the application guard already allows).
-- The consumer maps a violation of this index to MEETING_ALREADY_RECORDED (non-retryable); the whole
-- transaction rolls back, so the meeting number allocated for the losing attempt is returned.
--
-- Rollback:
--   DROP INDEX IF EXISTS meeting.uq_meetings_recorded_held;
--   ALTER TABLE meeting.meetings DROP COLUMN IF EXISTS recorded_held_at;

SET lock_timeout = '5s';

ALTER TABLE meeting.meetings ADD COLUMN IF NOT EXISTS recorded_held_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_recorded_held
    ON meeting.meetings (tenant_id, COALESCE(committee_id, '00000000-0000-0000-0000-000000000000'::uuid), title, scheduled_at)
    WHERE recorded_held_at IS NOT NULL AND status <> 'cancelled';
