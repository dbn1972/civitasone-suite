-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: analytics-service

SET lock_timeout = '5s';

-- ============================================================================
-- analytics.query_runs.status
-- Valid states: running, completed, failed, cancelled
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE analytics.query_runs
    ADD CONSTRAINT query_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- analytics.export_jobs.status
-- NOTE: this table's real lifecycle is pending → processing → completed |
-- failed (schema.ts default "pending"), not "queued". A later migration
-- (0010_export_jobs_enhancement.sql) adds the correctly-valued
-- export_jobs_status_check ('pending','processing','completed','failed').
-- Do NOT add a constraint with the SAME name and a DIFFERENT vocabulary here
-- — whichever migration runs first wins the name and the second silently
-- no-ops (duplicate_object), so keeping both in sync matters. Nothing to add;
-- 0010 owns this constraint.
-- ============================================================================

-- ============================================================================
-- analytics.dashboards.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE analytics.dashboards
    ADD CONSTRAINT dashboards_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE analytics.query_runs VALIDATE CONSTRAINT query_runs_status_check;
ALTER TABLE analytics.dashboards VALIDATE CONSTRAINT dashboards_status_check;
