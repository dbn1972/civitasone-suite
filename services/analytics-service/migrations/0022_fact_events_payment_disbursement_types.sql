-- Purpose: UAT b24. modules/facts/normalize.ts derives event_type by stripping the source-service prefix off the
--          INBOUND topic (topics.ts). Two of the eleven inbound topics produced values the closed whitelist
--          fact_events_event_type_check (0012/0014/0018) never admitted, so every one of those events was refused
--          with a check violation (23514), retried, and dead-lettered - the finance payment and grant disbursement
--          facts never reached analytics:
--            finance.payment.made           -> payment.made
--            grant.disbursement.completed   -> disbursement.completed
--          Re-create the whitelist with those two added (everything 0018 admitted is kept).
-- Rollback: re-apply the constraint from 0018 (drop, add without 'payment.made' and 'disbursement.completed').
--           Rows already written with those two types must be deleted first.
-- Affected services: analytics-service
-- fact_events is a declaratively partitioned table (0007); a CHECK added on the parent applies to every partition.
-- The model (src/modules/facts/schema.ts) carries no CHECK, so no model/drizzle change is needed.

SET lock_timeout = '5s';

ALTER TABLE analytics.fact_events DROP CONSTRAINT IF EXISTS fact_events_event_type_check;

DO $$ BEGIN
  ALTER TABLE analytics.fact_events
    ADD CONSTRAINT fact_events_event_type_check
    CHECK (event_type IN (
      -- finance / grants / procurement
      'payment.released', 'release.processed', 'po.approved',
      'payment.made', 'disbursement.completed',
      -- governance (meeting-service)
      'attendance.marked', 'vote.concluded', 'meeting.completed',
      -- judiciary (court-service)
      'case.registered', 'case.status_changed', 'hearing.scheduled',
      -- premises (visitor-service)
      'checked_in', 'overstay.alerted',
      -- activation funnel (source = 'activation')
      'signin', 'wizard_opened', 'org-profile', 'branches', 'departments',
      'people', 'modules', 'first_transaction'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
