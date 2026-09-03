-- 0031_breach_notification_on_time.sql
-- Fix: the F3 consumer's securityBreachNotificationSubmit handler
-- (src/modules/security-incident/consumer.ts) computes `onTime` — whether
-- the breach notification was submitted within the 72-hour DPDP §8(6)
-- statutory deadline (admin.sec_breach_notifications.deadline_at) — but
-- only ever puts it on the OUTBOUND "security.breach.notification_submitted"
-- event payload. It was never written to the row itself, so the single most
-- legally significant fact about a breach-notification record (did this
-- filing meet the statutory deadline?) was not queryable in the database —
-- only recoverable by replaying the outbox/event log, which is not how
-- compliance reporting or the GET endpoints read this table.
--
-- Column name follows this schema's existing boolean convention: `is_breach`
-- on admin.sec_incidents (schema.ts) -> `isBreach`/`is_breach`, so this adds
-- `isOnTime` / `is_on_time`.
--
-- Nullable, not NOT NULL DEFAULT false: `is_on_time` is only meaningful once
-- a notification has actually been submitted (mirrors submitted_at, which is
-- itself nullable for the same reason — a 'pending' row has no submission to
-- judge on-time-ness of). Defaulting unsubmitted rows to false would assert
-- "submitted late" for notifications that have not been submitted at all,
-- which is a false, and worse, compliance-adverse statement for a DPDP §8(6)
-- record. NULL correctly means "not yet determined."
--
-- Backfill: safe and done in this migration, because both source columns
-- (`deadline_at`, `submitted_at`) already live on THIS table (no join to
-- sec_incidents.detected_at needed — deadline_at is itself
-- detected_at + window_hours, computed once at creation time in the F3
-- producer and stored, so it is already the correct historical deadline).
-- Every row with a non-null submitted_at is backfilled deterministically as
-- (submitted_at <= deadline_at); rows still 'pending' (submitted_at IS NULL)
-- are left NULL, consistent with the "not yet determined" semantics above.
--
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER TABLE admin.sec_breach_notifications DROP COLUMN IF EXISTS is_on_time;
SET lock_timeout = '5s';

ALTER TABLE admin.sec_breach_notifications
  ADD COLUMN IF NOT EXISTS is_on_time boolean;

-- Backfill existing submitted rows from already-stored deadline_at/submitted_at.
UPDATE admin.sec_breach_notifications
SET is_on_time = (submitted_at <= deadline_at)
WHERE submitted_at IS NOT NULL
  AND is_on_time IS NULL;
