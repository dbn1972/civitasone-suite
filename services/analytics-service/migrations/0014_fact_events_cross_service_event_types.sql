-- Purpose: Extend analytics.fact_events.event_type whitelist to admit the
--          cross-service governance (meeting), judiciary (court) and premises
--          (visitor) domain facts now ingested via topics.ts INBOUND.
--          Follow-up to 0012_additional_status_type_constraints.sql, which
--          closed the set to the original finance/grants/procurement events.
-- Rollback: restore the 3-value constraint from 0012 (drop, re-add with only
--           'payment.released','release.processed','po.approved').
-- Affected services: analytics-service
--
-- event_type is derived in modules/facts/normalize.ts by stripping the source
-- service prefix off the INBOUND topic (topics.ts):
--   meeting.attendance.marked   -> attendance.marked
--   meeting.vote.concluded      -> vote.concluded
--   meeting.meeting.completed   -> meeting.completed
--   court.case.registered       -> case.registered
--   court.case.status_changed   -> case.status_changed
--   court.hearing.scheduled     -> hearing.scheduled
--   visitor.checked_in          -> checked_in
--   visitor.overstay.alerted    -> overstay.alerted

SET lock_timeout = '5s';

ALTER TABLE analytics.fact_events DROP CONSTRAINT IF EXISTS fact_events_event_type_check;

DO $$ BEGIN
  ALTER TABLE analytics.fact_events
    ADD CONSTRAINT fact_events_event_type_check
    CHECK (event_type IN (
      -- finance / grants / procurement (original)
      'payment.released', 'release.processed', 'po.approved',
      -- governance (meeting-service)
      'attendance.marked', 'vote.concluded', 'meeting.completed',
      -- judiciary (court-service)
      'case.registered', 'case.status_changed', 'hearing.scheduled',
      -- premises (visitor-service)
      'checked_in', 'overstay.alerted'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE analytics.fact_events VALIDATE CONSTRAINT fact_events_event_type_check;
