-- Migration: 0041_platform_integrations_policy_approval.sql
-- Purpose: turning the per-tenant `require_production_approval` policy OFF needs a
--   second approver. The OFF request is recorded here; only the approve consumer flips
--   the setting. Turning it ON stays single-actor (it only tightens control).
--   Same pattern as production_switch_requests (0039): the decision is a conditional
--   UPDATE (`status = 'pending' AND requested_by <> actor`) backed by a CHECK.
-- Tenant-scoped, FORCE RLS (mirrors 0039).
-- Additive + idempotent. Rollback: DROP TABLE platform_integrations.policy_change_requests;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform_integrations.policy_change_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'pending',
  reason        text        NOT NULL,
  requested_by  uuid        NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS idx_pi_policy_requests_tenant_status
  ON platform_integrations.policy_change_requests (tenant_id, status);
-- At most one pending policy-change request per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_policy_requests_one_pending
  ON platform_integrations.policy_change_requests (tenant_id) WHERE status = 'pending';

DO $$ BEGIN
  ALTER TABLE platform_integrations.policy_change_requests
    ADD CONSTRAINT pi_policy_requests_status_chk CHECK (status IN ('pending','approved','rejected','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE platform_integrations.policy_change_requests
    ADD CONSTRAINT pi_policy_requests_maker_checker_chk CHECK (
      status = 'pending' OR status = 'cancelled' OR decided_by IS DISTINCT FROM requested_by
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE platform_integrations.policy_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations.policy_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON platform_integrations.policy_change_requests;
CREATE POLICY tenant_isolation_policy ON platform_integrations.policy_change_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_integrations.policy_change_requests TO admin_svc;
  END IF;
END $g$;
