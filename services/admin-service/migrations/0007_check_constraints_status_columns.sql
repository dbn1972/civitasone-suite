-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: admin-service

SET lock_timeout = '5s';

-- ============================================================================
-- tenants.admin_tenants.status
-- Valid states: draft, active, suspended, decommissioned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tenants.admin_tenants
    ADD CONSTRAINT admin_tenants_status_check
    CHECK (status IN ('draft', 'active', 'suspended', 'decommissioned'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- health.admin_health_snapshots.status
-- Valid states: ok, degraded, down
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE health.admin_health_snapshots
    ADD CONSTRAINT admin_health_snapshots_status_check
    CHECK (status IN ('ok', 'degraded', 'down'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- backup.admin_backup_runs.status
-- Valid states: pending, running, completed, failed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE backup.admin_backup_runs
    ADD CONSTRAINT admin_backup_runs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- support.admin_support_tickets.status
-- Valid states: open, in_progress, resolved, closed
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE support.admin_support_tickets
    ADD CONSTRAINT admin_support_tickets_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- support.admin_support_tickets.priority
-- Valid values: low, normal, high, urgent
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE support.admin_support_tickets
    ADD CONSTRAINT admin_support_tickets_priority_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- api_keys.admin_api_keys.status
-- Valid states: active, revoked, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE api_keys.admin_api_keys
    ADD CONSTRAINT admin_api_keys_status_check
    CHECK (status IN ('active', 'revoked', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: custom_domains, data_export, scheduled_jobs already use pgEnum types
-- (domain_status, ssl_status, export_status, job_run_status) — no CHECK needed.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE tenants.admin_tenants VALIDATE CONSTRAINT admin_tenants_status_check;
ALTER TABLE health.admin_health_snapshots VALIDATE CONSTRAINT admin_health_snapshots_status_check;
ALTER TABLE backup.admin_backup_runs VALIDATE CONSTRAINT admin_backup_runs_status_check;
ALTER TABLE support.admin_support_tickets VALIDATE CONSTRAINT admin_support_tickets_status_check;
ALTER TABLE support.admin_support_tickets VALIDATE CONSTRAINT admin_support_tickets_priority_check;
ALTER TABLE api_keys.admin_api_keys VALIDATE CONSTRAINT admin_api_keys_status_check;
