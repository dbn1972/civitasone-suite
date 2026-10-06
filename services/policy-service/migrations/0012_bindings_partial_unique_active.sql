-- 0012_bindings_partial_unique_active.sql
-- GAP-POLICY-BINDINGS-05 (and the re-grant bug documented in
-- comp-007-bindings-smoke.test.ts): 0001_init.sql created
--   CREATE UNIQUE INDEX idx_bindings_user_role ON bindings.bindings(tenant_id, user_id, role_id)
-- as a PLAIN (non-partial) unique index. Once ANY binding row has existed for
-- a (tenant, user, role) triple -- active OR revoked -- Postgres permanently
-- refuses a second row for that triple. So an admin who revokes a role and
-- later wants to re-grant it to the same user is silently unable to (the
-- async consumer's INSERT fails and the command dead-letters; the create
-- route already replied 202, so nothing surfaces the failure).
--
-- Fix: the uniqueness we actually want is "at most one ACTIVE binding per
-- (tenant, user, role)"; revoked history rows must not block a re-grant.
-- Replace the full index with a partial unique index scoped to active rows.
-- Additive + idempotent: safe to run twice (IF EXISTS / IF NOT EXISTS).
--
-- Rollback:
--   DROP INDEX IF EXISTS bindings.idx_bindings_user_role_active;
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_user_role
--     ON bindings.bindings(tenant_id, user_id, role_id);

SET lock_timeout = '5s';

DROP INDEX IF EXISTS bindings.idx_bindings_user_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_user_role_active
  ON bindings.bindings(tenant_id, user_id, role_id)
  WHERE status = 'active';
