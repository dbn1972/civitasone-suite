-- 0032_downgrade_requests.sql
-- OWNER DECISION #24 (TENANT-ADMIN-PLANS-02): a plan downgrade is a REQUEST with a
-- required reason, blocked when current usage exceeds the target plan's limits,
-- and approved by platform billing (a different person from the requester).
-- subscriptions.downgrade_requests holds the request, the usage snapshot taken
-- when it was made, and the decision. One OPEN request per tenant at a time.
-- Tenant-scoped with FORCED RLS; platform billing finds pending requests of all
-- tenants only through the SECURITY DEFINER function below (control-plane path,
-- same pattern as 0030): the HTTP route is the authority on who may call it.
-- Additive + idempotent.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS subscriptions.downgrade_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  subscription_id  uuid NOT NULL,
  from_plan_id     uuid NOT NULL,
  target_plan_id   uuid NOT NULL,
  reason           text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  usage_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           varchar(16) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  -- Maker-checker at the database: the approver can never be the requester.
  CONSTRAINT chk_downgrade_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_downgrade_requests_tenant ON subscriptions.downgrade_requests (tenant_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_downgrade_requests_one_pending
  ON subscriptions.downgrade_requests (tenant_id) WHERE status = 'pending';

ALTER TABLE subscriptions.downgrade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.downgrade_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON subscriptions.downgrade_requests;
CREATE POLICY tenant_isolation_policy ON subscriptions.downgrade_requests
  USING (tenant_id = tenant.current_tenant_id())
  WITH CHECK (tenant_id = tenant.current_tenant_id());

-- Platform billing's work queue: pending requests across tenants (read-only,
-- bounded, directory columns only). Executable only by the service role.
DROP POLICY IF EXISTS platform_bypass_read_policy ON subscriptions.downgrade_requests;
CREATE POLICY platform_bypass_read_policy ON subscriptions.downgrade_requests
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

CREATE OR REPLACE FUNCTION subscriptions.list_pending_downgrades(p_limit int)
  RETURNS TABLE (
    id uuid, tenant_id uuid, from_plan_id uuid, target_plan_id uuid, reason text,
    usage_snapshot jsonb, requested_by uuid, requested_at timestamptz
  )
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = subscriptions, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_prev text := current_setting('app.platform_bypass', true);
  BEGIN
    PERFORM set_config('app.platform_bypass', 'true', true);
    RETURN QUERY
      SELECT d.id, d.tenant_id, d.from_plan_id, d.target_plan_id, d.reason,
             d.usage_snapshot, d.requested_by, d.requested_at
      FROM subscriptions.downgrade_requests d
      WHERE d.status = 'pending'
      ORDER BY d.requested_at ASC, d.id
      LIMIT greatest(least(p_limit, 200), 1);
    PERFORM set_config('app.platform_bypass', coalesce(v_prev, ''), true);
  END;
  $$;

REVOKE ALL ON FUNCTION subscriptions.list_pending_downgrades(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscriptions.list_pending_downgrades(int) TO tenant_svc;
