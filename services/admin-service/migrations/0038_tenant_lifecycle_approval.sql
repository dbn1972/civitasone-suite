-- Migration: 0038_tenant_lifecycle_approval.sql
-- Purpose: GAP-ADMIN-TENANTS-DETAIL-05 (remainder) -- maker-checker for tenant
--          lifecycle actions (suspend / reactivate / edit core details) and for
--          changes to the approval policy itself.
--
--          Who approves is a per-tenant policy stored in that tenant's own
--          config: tenants.admin_tenants.settings -> 'approvalPolicy'
--          (requiresSecondApprover, approverRoles, minApprovals,
--          reasonRequired, notifyTenantAdmins; defaults applied in code, see
--          modules/tenants/lifecycle-domain.ts). No column is added for it:
--          `settings` is already jsonb, so there is nothing to keep in sync.
--
--          Two new tables hold the requests and the individual approvals.
--          `tenant_id` is the TARGET tenant (the one being suspended etc.),
--          which is also what the consumer's tenant context is scoped to.
--          Platform operators live in a different tenant, so the read side is
--          reached through the same app.platform_bypass SELECT-only policy that
--          migration 0011 added for tenants.admin_tenants; writes stay strictly
--          tenant-scoped.
--
--          Race safety: a request is decided by a conditional UPDATE
--          (WHERE status = 'pending' ... RETURNING); the unique partial index
--          below allows only ONE open request per (tenant, kind) so a double
--          submit cannot queue two suspensions.
--
-- Rollback: DROP TABLE tenants.tenant_lifecycle_approvals;
--           DROP TABLE tenants.tenant_lifecycle_requests;
-- Affected services: admin-service
-- Idempotent: every statement is IF NOT EXISTS / DROP IF EXISTS.

SET lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenants.tenant_lifecycle_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  kind               VARCHAR(24) NOT NULL,
  status             VARCHAR(16) NOT NULL DEFAULT 'pending',
  reason             TEXT NOT NULL DEFAULT '',
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_at       TIMESTAMPTZ,
  requested_by       UUID NOT NULL,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  required_approvals INTEGER NOT NULL DEFAULT 1,
  approver_roles     JSONB NOT NULL DEFAULT '["super_admin","platform_admin"]'::jsonb,
  approvals_count    INTEGER NOT NULL DEFAULT 0,
  decided_by         UUID,
  decided_at         TIMESTAMPTZ,
  decision_reason    TEXT,
  executed_at        TIMESTAMPTZ,
  failure_code       VARCHAR(64),
  cancelled_by       UUID,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,
  direct_execution   BOOLEAN NOT NULL DEFAULT FALSE,
  version            INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT tenant_lifecycle_requests_kind_check
    CHECK (kind IN ('suspend', 'reactivate', 'edit', 'policy_change')),
  CONSTRAINT tenant_lifecycle_requests_status_check
    CHECK (status IN ('pending', 'scheduled', 'executed', 'rejected', 'failed', 'cancelled')),
  CONSTRAINT tenant_lifecycle_requests_approvals_check
    CHECK (required_approvals >= 0 AND approvals_count >= 0)
);

-- One open (pending or scheduled) request per tenant per kind: a double submit
-- or a second operator racing the first gets a unique violation, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_lifecycle_requests_open
  ON tenants.tenant_lifecycle_requests (tenant_id, kind)
  WHERE status IN ('pending', 'scheduled');

CREATE INDEX IF NOT EXISTS ix_tenant_lifecycle_requests_tenant
  ON tenants.tenant_lifecycle_requests (tenant_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS ix_tenant_lifecycle_requests_due
  ON tenants.tenant_lifecycle_requests (effective_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS tenants.tenant_lifecycle_approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  request_id     UUID NOT NULL REFERENCES tenants.tenant_lifecycle_requests(id) ON DELETE CASCADE,
  approver_id    UUID NOT NULL,
  approver_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_tenant_lifecycle_approvals_once UNIQUE (request_id, approver_id)
);

CREATE INDEX IF NOT EXISTS ix_tenant_lifecycle_approvals_tenant
  ON tenants.tenant_lifecycle_approvals (tenant_id, request_id);

ALTER TABLE tenants.tenant_lifecycle_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.tenant_lifecycle_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenants.tenant_lifecycle_requests;
CREATE POLICY tenant_isolation_policy ON tenants.tenant_lifecycle_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS platform_bypass_read_policy ON tenants.tenant_lifecycle_requests;
CREATE POLICY platform_bypass_read_policy ON tenants.tenant_lifecycle_requests
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

ALTER TABLE tenants.tenant_lifecycle_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.tenant_lifecycle_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenants.tenant_lifecycle_approvals;
CREATE POLICY tenant_isolation_policy ON tenants.tenant_lifecycle_approvals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS platform_bypass_read_policy ON tenants.tenant_lifecycle_approvals;
CREATE POLICY platform_bypass_read_policy ON tenants.tenant_lifecycle_approvals
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT USAGE ON SCHEMA tenants TO admin_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON tenants.tenant_lifecycle_requests, tenants.tenant_lifecycle_approvals TO admin_svc;
  END IF;
END $$;
