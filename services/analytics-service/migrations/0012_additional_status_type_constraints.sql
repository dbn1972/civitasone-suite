-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0008_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: analytics-service

SET lock_timeout = '5s';

-- ============================================================================
-- analytics.dashboard_widgets.viz_type
-- Valid states: table, bar, line, stat (source: modules/dashboards/validators.ts
-- addWidgetBody.vizType enum; schema.ts default "table")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE analytics.dashboard_widgets
    ADD CONSTRAINT dashboard_widgets_viz_type_check
    CHECK (viz_type IN ('table', 'bar', 'line', 'stat'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- analytics.fact_events.event_type
-- Valid states: payment.released, release.processed, po.approved (source:
-- modules/facts/normalize.ts — eventType is derived by stripping the source
-- service prefix off the fixed INBOUND topics in topics.ts: finance.payment
-- .released -> payment.released, grants.release.processed -> release
-- .processed, procurement.po.approved -> po.approved. analytics only
-- subscribes to these 3 INBOUND topics, so the resulting set is closed.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE analytics.fact_events
    ADD CONSTRAINT fact_events_event_type_check
    CHECK (event_type IN ('payment.released', 'release.processed', 'po.approved'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- analytics.fact_events.status
-- SKIPPED: normalize.ts sets this from the upstream event payload's own
-- "status" field verbatim (str(p.status, "recorded")), with "recorded" only
-- as a fallback when the field is absent. Since fact_events is a generic
-- cross-domain projection fed by finance, grants, and procurement events
-- (and potentially more sources added later per INBOUND in topics.ts), the
-- upstream status vocabulary is not owned or enumerated by analytics-service
-- and can vary per source event. No CHECK constraint added — would require
-- guessing at each publisher's internal status vocabulary.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE analytics.dashboard_widgets VALIDATE CONSTRAINT dashboard_widgets_viz_type_check;
ALTER TABLE analytics.fact_events VALIDATE CONSTRAINT fact_events_event_type_check;
