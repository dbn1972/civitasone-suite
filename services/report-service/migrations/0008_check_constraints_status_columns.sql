-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: report-service

SET lock_timeout = '5s';

-- ============================================================================
-- reports.jobs.status
-- Valid states: queued, processing, completed, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE reports.jobs
    ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- reports.kpis.status
-- Valid states: on_track, at_risk, off_track
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE reports.kpis
    ADD CONSTRAINT kpis_status_check
    CHECK (status IN ('on_track', 'at_risk', 'off_track'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE reports.jobs VALIDATE CONSTRAINT jobs_status_check;
ALTER TABLE reports.kpis VALIDATE CONSTRAINT kpis_status_check;
