-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: tenant-service

SET lock_timeout = '5s';

-- ============================================================================
-- tenant.tenants.status
-- Valid states: draft, active, suspended, decommissioned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE tenant.tenants
    ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('draft', 'active', 'suspended', 'decommissioned'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: plans.plans.edition and plans.plans.billing_cycle already use pgEnum types.
-- NOTE: subscriptions.subscriptions.status already uses pgEnum (subscription_status).
-- NOTE: quotas.quotas.resource already uses pgEnum (quota_resource).
-- No CHECK constraints needed for these.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE tenant.tenants VALIDATE CONSTRAINT tenants_status_check;
