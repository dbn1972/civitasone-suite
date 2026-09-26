-- 0152_screening_events_override_denied_action.sql
--
-- Purpose: allow hrms_screening_events.action = 'override_denied' -- the
-- audit-trail row POST /v1/hrms/applications/:id/screening-decision now
-- writes when a decision is denied for being an implicit override
-- (R-RA-0111), whether caught synchronously (a request that reads an
-- already-decided application) or after losing the new atomic
-- conditional-UPDATE race a genuinely concurrent second decision hits
-- (screening-repo.ts's setScreeningIfPending returning false).
--
-- DEFECT THIS FIXES (High, R-RA-0111 concurrency)
-- Two genuinely simultaneous decisions on the same pending application both
-- read 'pending' before either write landed (screening-routes.ts published
-- both to the fire-and-forget F3 queue, whose consumer never re-checked
-- screening_decision before writing), so BOTH were recorded as ordinary,
-- non-override 'decision' events and the second silently overwrote the
-- first -- with zero trace an override was ever attempted.
--
-- Closing the race means the losing request is now rejected via the
-- maker-checker override path (409 OVERRIDE_VIA_MAKER_CHECKER) instead of
-- silently applied -- and that denial itself needs an audit trail, so it
-- doesn't vanish without a trace either. Without this migration, that INSERT
-- fails hrms_screening_events_action_check (23514, caught by the route's
-- generic error handler) and the denial surfaces to the caller as a 500
-- instead of the intended 409.
--
-- Additive + idempotent (DROP CONSTRAINT IF EXISTS, then re-add with the
-- widened list).
--
-- Rollback (safe only if no 'override_denied' rows exist yet):
--   ALTER TABLE recruitment.hrms_screening_events DROP CONSTRAINT IF EXISTS hrms_screening_events_action_check;
--   ALTER TABLE recruitment.hrms_screening_events
--     ADD CONSTRAINT hrms_screening_events_action_check
--     CHECK (action IN ('auto_screen','decision','override','shortlist','freeze'));

ALTER TABLE recruitment.hrms_screening_events
  DROP CONSTRAINT IF EXISTS hrms_screening_events_action_check;

ALTER TABLE recruitment.hrms_screening_events
  ADD CONSTRAINT hrms_screening_events_action_check
  CHECK (action IN ('auto_screen','decision','override','shortlist','freeze','override_denied'));
