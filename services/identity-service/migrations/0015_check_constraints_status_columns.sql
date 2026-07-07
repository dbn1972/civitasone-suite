-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: identity-service

SET lock_timeout = '5s';

-- ============================================================================
-- users.users.status
-- Valid states: active, suspended, deactivated
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE users.users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'suspended', 'deactivated'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- users.service_accounts.status
-- Valid states: active, revoked, suspended
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE users.service_accounts
    ADD CONSTRAINT service_accounts_status_check
    CHECK (status IN ('active', 'revoked', 'suspended'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- sessions.sessions.status
-- Valid states: active, expired, revoked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE sessions.sessions
    ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('active', 'expired', 'revoked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- apikeys.api_keys.status
-- Valid states: active, revoked, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE apikeys.api_keys
    ADD CONSTRAINT api_keys_status_check
    CHECK (status IN ('active', 'revoked', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rbac.role_assignments.status
-- Valid states: active, revoked
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rbac.role_assignments
    ADD CONSTRAINT role_assignments_status_check
    CHECK (status IN ('active', 'revoked'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- breakglass.grants.status
-- Valid states: active, closed, expired
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE breakglass.grants
    ADD CONSTRAINT grants_status_check
    CHECK (status IN ('active', 'closed', 'expired'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- sync.processed_mutations.status
-- Valid states: applied, rejected, conflict
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE sync.processed_mutations
    ADD CONSTRAINT processed_mutations_status_check
    CHECK (status IN ('applied', 'rejected', 'conflict'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE users.users VALIDATE CONSTRAINT users_status_check;
ALTER TABLE users.service_accounts VALIDATE CONSTRAINT service_accounts_status_check;
ALTER TABLE sessions.sessions VALIDATE CONSTRAINT sessions_status_check;
ALTER TABLE apikeys.api_keys VALIDATE CONSTRAINT api_keys_status_check;
ALTER TABLE rbac.role_assignments VALIDATE CONSTRAINT role_assignments_status_check;
ALTER TABLE breakglass.grants VALIDATE CONSTRAINT grants_status_check;
ALTER TABLE sync.processed_mutations VALIDATE CONSTRAINT processed_mutations_status_check;
