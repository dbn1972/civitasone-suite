-- Purpose: GAP-TENANT-ADMIN-ACTIVATION-05. The activation funnel (north-star TTFRT)
--          stores each golden-path milestone as one analytics.fact_events row with
--          source='activation' and event_type=<step> (modules/activation/repo.ts).
--          fact_events_event_type_check (0012/0014) is a closed whitelist that never
--          included the activation steps, so EVERY POST /v1/analytics/activation/events
--          failed with a check violation (23514 -> HTTP 500) on a migrated database and
--          the funnel stayed empty. Re-create the whitelist with the activation steps.
-- Rollback: re-apply the constraint from 0014 (drop, add with the 11 non-activation
--           event types only). Rows already written with an activation step must be
--           deleted first (source = 'activation').
-- Affected services: analytics-service
-- Steps come from FUNNEL_STEPS in modules/activation/routes.ts (kept in sync by the
-- activation-funnel-real-db test, which records each one).

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
      'checked_in', 'overstay.alerted',
      -- activation funnel (source = 'activation')
      'signin', 'wizard_opened', 'org-profile', 'branches', 'departments',
      'people', 'modules', 'first_transaction'
    ))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
