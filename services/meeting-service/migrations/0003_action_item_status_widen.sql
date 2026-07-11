-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0003_action_item_status_widen
-- Purpose:   Widen meeting.action_items.status from VARCHAR(16) to VARCHAR(24).
--            Requirement 9.2 defines the action-item lifecycle state
--            'evidence_submitted' (18 chars), which does not fit VARCHAR(16); the
--            initial 0001 migration under-sized the column. This is a widening
--            (non-destructive) type change so every documented status value fits.
-- Affected:  meeting-service only (meeting.action_items).
-- Rollback:  No data is lost by widening. To revert (only safe if no row holds a
--            value longer than 16 chars):
--              ALTER TABLE meeting.action_items
--                ALTER COLUMN status TYPE VARCHAR(16);
-- Safety:    Widening a VARCHAR length rewrites no rows and takes only a brief
--            catalog lock; lock_timeout bounds any wait. Idempotent — re-running
--            simply re-asserts the (already) wider type.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

ALTER TABLE meeting.action_items
    ALTER COLUMN status TYPE VARCHAR(24);
