-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0004_widen_resolution_vote_type
-- Purpose:   Widen meeting.resolutions.vote_type from VARCHAR(16) to VARCHAR(32).
--            The circulation-decision flow (Req 12.x, decision/consumer.ts
--            handleResolutionCirculationInit) persists the vote_type value
--            'circulation_resolution' (22 chars) when a resolution is decided by
--            circulation outside a formal meeting. That value does not fit the
--            original VARCHAR(16) column defined in 0001_meeting_core.sql, so the
--            INSERT fails at runtime with:
--              PostgresError: value too long for type character varying(16)
--            This is a widening (non-destructive) type change so every documented
--            vote_type value — including 'circulation_resolution' — fits.
-- Affected:  meeting-service only (meeting.resolutions).
-- Rollback:  No data is lost by widening. To revert (only safe if no row holds a
--            value longer than 16 chars):
--              ALTER TABLE meeting.resolutions
--                ALTER COLUMN vote_type TYPE VARCHAR(16);
-- Safety:    Widening a VARCHAR length rewrites no rows and takes only a brief
--            catalog lock; lock_timeout bounds any wait. Idempotent — re-running
--            simply re-asserts the (already) wider type.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

ALTER TABLE meeting.resolutions
    ALTER COLUMN vote_type TYPE VARCHAR(32);
