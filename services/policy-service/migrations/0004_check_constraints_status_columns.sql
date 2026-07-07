-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: policy-service

SET lock_timeout = '5s';

-- ============================================================================
-- roles.roles.status
-- Valid states: active, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE roles.roles
    ADD CONSTRAINT roles_status_check
    CHECK (status IN ('active', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- bindings.bindings.status
-- Valid states: active, revoked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE bindings.bindings
    ADD CONSTRAINT bindings_status_check
    CHECK (status IN ('active', 'revoked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- bindings.breakglass.status
-- Valid states: pending, approved, denied, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE bindings.breakglass
    ADD CONSTRAINT breakglass_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE roles.roles VALIDATE CONSTRAINT roles_status_check;
ALTER TABLE bindings.bindings VALIDATE CONSTRAINT bindings_status_check;
ALTER TABLE bindings.breakglass VALIDATE CONSTRAINT breakglass_status_check;
