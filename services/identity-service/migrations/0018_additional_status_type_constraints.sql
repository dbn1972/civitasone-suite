-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to 0015_check_constraints_status_columns.sql)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: identity-service

SET lock_timeout = '5s';

-- ============================================================================
-- sync.entity_changelog.operation
-- Valid states: create, update, delete, upsert
-- (feeder.ts writes "upsert" (default) or "delete" for event-driven entries;
-- sync/routes.ts push-mutation endpoint writes "create"/"update"/"delete"
-- directly from client mutations typed as "create" | "update" | "delete")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE sync.entity_changelog
    ADD CONSTRAINT entity_changelog_operation_check
    CHECK (operation IN ('create', 'update', 'delete', 'upsert'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- mfa.configs.method
-- Valid states: totp, sms, email
-- (commands.ts z.enum(["totp","sms","email"]); consumer.ts inserts the
-- validated method; routes.ts currently only implements totp flow but the
-- schema supports all three)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE mfa.configs
    ADD CONSTRAINT mfa_configs_method_check
    CHECK (method IN ('totp', 'sms', 'email'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- apikeys.api_key_audit.action
-- Valid states: issue, rotate, revoke, denied
-- (commands.ts repo.audit calls write "issue"/"rotate"/"revoke"; key
-- validation middleware writes "denied" for expired/revoked/scope-miss)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE apikeys.api_key_audit
    ADD CONSTRAINT api_key_audit_action_check
    CHECK (action IN ('issue', 'rotate', 'revoke', 'denied'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- rbac.role_assignment_history.action
-- Valid states: assign, revoke
-- (consumer.ts inserts "assign" on role grant, "revoke" on role removal)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE rbac.role_assignment_history
    ADD CONSTRAINT role_assignment_history_action_check
    CHECK (action IN ('assign', 'revoke'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- NOTE: users.users.status — already constrained by users_status_check (0015)
-- covering ('active','suspended','deactivated'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: users.service_accounts.status — already constrained by
-- service_accounts_status_check (0015) covering
-- ('active','revoked','suspended'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: sessions.sessions.status — already constrained by
-- sessions_status_check (0015) covering ('active','expired','revoked').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: apikeys.api_keys.status — already constrained by
-- api_keys_status_check (0015) covering ('active','revoked','expired').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: rbac.role_assignments.status — already constrained by
-- role_assignments_status_check (0015) covering ('active','revoked').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: breakglass.grants.status — already constrained by
-- grants_status_check (0015) covering ('active','closed','expired').
-- Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: sync.processed_mutations.status — already constrained by
-- processed_mutations_status_check (0015) covering
-- ('applied','rejected','conflict'). Nothing to add.
-- ============================================================================

-- ============================================================================
-- NOTE: devices.registered_devices.platform — free-form device identifier
-- (android, ios, web, etc.) not validated via zod enum. No bounded set.
-- ============================================================================

-- ============================================================================
-- NOTE: devices.registered_devices.trust_level — single default value
-- "recognized" with no state transitions or enum defined in code.
-- Not a state machine column. Skipped.
-- ============================================================================

-- ============================================================================
-- NOTE: sessions.sessions.mfa_method — nullable, free-form at validator level
-- (z.string().max(32).optional()). While only "totp" is written today, the
-- column is loosely coupled. Constrained upstream at mfa.configs.method.
-- ============================================================================

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE sync.entity_changelog VALIDATE CONSTRAINT entity_changelog_operation_check;
ALTER TABLE mfa.configs VALIDATE CONSTRAINT mfa_configs_method_check;
ALTER TABLE apikeys.api_key_audit VALIDATE CONSTRAINT api_key_audit_action_check;
ALTER TABLE rbac.role_assignment_history VALIDATE CONSTRAINT role_assignment_history_action_check;
