-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0004_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: policy-service

SET lock_timeout = '5s';

-- ============================================================================
-- roles.permissions.effect
-- Valid states: allow, deny
-- (domain.ts Permission.effect typed as "allow" | "deny"; validators.ts
-- z.enum(["allow","deny"]).default("allow"); consumer.ts inserts verbatim)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE roles.permissions
    ADD CONSTRAINT permissions_effect_check
    CHECK (effect IN ('allow', 'deny'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: roles.roles.status — already constrained by roles_status_check (0004)
-- covering ('active','archived'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: bindings.bindings.status — already constrained by
-- bindings_status_check (0004) covering ('active','revoked'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: bindings.breakglass.status — already constrained by
-- breakglass_status_check (0004) covering
-- ('pending','approved','denied','expired'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: roles.permissions.action — free-form varchar(64) representing RBAC
-- permission actions (z.string().min(1).max(64)). Not a bounded state machine.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE roles.permissions VALIDATE CONSTRAINT permissions_effect_check;
