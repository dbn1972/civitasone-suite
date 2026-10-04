-- Migration: 0028_operator_change_requests.sql
-- Purpose: GAP-ADMIN-OPERATORS-05 -- maker-checker for platform-operator management.
--          Suspending, reactivating or changing the role of a platform operator
--          (an active holder of super_admin / platform_admin) is a REQUEST that a
--          DIFFERENT active super_admin approves. Nothing changes the operator
--          (or Keycloak) until approval. Maker != checker is also a CHECK here,
--          so no code path can approve its own request.
--          'grant' makes a user who holds no platform role an operator (from_role_key = 'none').
--          At most one pending request per operator (partial unique index).
-- Rollback: DROP TABLE users.operator_change_requests;
-- Affected services: identity-service
-- Idempotent: IF NOT EXISTS / DROP IF EXISTS throughout.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS users.operator_change_requests (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  kind            VARCHAR(16) NOT NULL,
  target_user_id  UUID NOT NULL,
  from_role_key   VARCHAR(64) NOT NULL,
  to_role_key     VARCHAR(64),
  reason          VARCHAR(500) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  requested_by    UUID NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by      UUID,
  decided_at      TIMESTAMPTZ,
  decision_note   VARCHAR(500),
  refusal_reason  VARCHAR(200),
  applied_at      TIMESTAMPTZ,
  kc_sync         VARCHAR(16),
  version         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT operator_change_requests_kind_check
    CHECK (kind IN ('suspend', 'reactivate', 'role_change', 'grant')),
  CONSTRAINT operator_change_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refused')),
  CONSTRAINT operator_change_requests_role_change_check
    CHECK ((kind IN ('role_change', 'grant')) = (to_role_key IS NOT NULL)),
  CONSTRAINT operator_change_requests_reason_check
    CHECK (char_length(btrim(reason)) >= 3),
  CONSTRAINT operator_change_requests_kc_sync_check
    CHECK (kc_sync IS NULL OR kc_sync IN ('pending', 'ok', 'failed', 'skipped')),
  -- maker != checker, enforced by the database as well as the consumer
  CONSTRAINT operator_change_requests_maker_checker_check
    CHECK (decided_by IS NULL OR status = 'cancelled' OR decided_by <> requested_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_change_requests_pending
  ON users.operator_change_requests (tenant_id, target_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_operator_change_requests_queue
  ON users.operator_change_requests (tenant_id, status, requested_at DESC, id);

ALTER TABLE users.operator_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE users.operator_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON users.operator_change_requests;
CREATE POLICY tenant_isolation_policy ON users.operator_change_requests
  USING (tenant_id = users.current_tenant_id())
  WITH CHECK (tenant_id = users.current_tenant_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_svc') THEN
    GRANT USAGE ON SCHEMA users TO identity_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON users.operator_change_requests TO identity_svc;
  END IF;
END $$;
