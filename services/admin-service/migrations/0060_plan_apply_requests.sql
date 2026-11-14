-- 0060_plan_apply_requests.sql
-- M6: applying a sold plan to a tenant is a maker-checker change. A platform admin (maker) REQUESTS that a plan's
-- catalogue modules be applied to a tenant; a DIFFERENT platform admin (checker) approves, and only then the
-- tenant's entitlements change (through the existing composition applyPlanTx). Nothing is applied automatically.
-- Additive + idempotent. Apply as the owning service role (admin_svc), like 0001-0059. Tenant-scoped with FORCED RLS (same policy as composition.tenant_entitlement).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS composition.plan_apply_requests (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  plan_id             uuid,
  plan_code           text NOT NULL,
  -- the plan's catalogue modules as taken from the stored plan (tenant-service), and what they resolve to (core + hard deps) at request time
  module_ids          text[] NOT NULL,
  user_module_ids     text[] NOT NULL,
  profile_code        text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_reason     text,
  -- entitlements before the apply, so the audit trail shows exactly what changed
  previous_user_modules text[],
  CONSTRAINT chk_plan_apply_decided CHECK ((status = 'pending') = (decided_by IS NULL)),
  -- maker-checker at the database: the approver can never be the requester
  CONSTRAINT chk_plan_apply_maker_checker CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT chk_plan_apply_reject_reason CHECK (status <> 'rejected' OR char_length(btrim(coalesce(decision_reason, ''))) >= 5)
);
CREATE INDEX IF NOT EXISTS idx_plan_apply_requests_tenant ON composition.plan_apply_requests (tenant_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_apply_one_pending ON composition.plan_apply_requests (tenant_id) WHERE status = 'pending';

ALTER TABLE composition.plan_apply_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition.plan_apply_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON composition.plan_apply_requests;
CREATE POLICY tenant_isolation ON composition.plan_apply_requests
  USING (tenant_id = current_tenant_id());
