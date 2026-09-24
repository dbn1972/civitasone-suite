-- Purpose: add 'pending_effective' as a valid status for lifecycle.hrms_promotions
--   and lifecycle.hrms_transfers.
--
--   Bug fix (effective-dating enforcement): a promotion/transfer with a future
--   effectiveDate must NOT be applied to employee.hrms_employees immediately —
--   until now all four write paths (direct promotion create, direct transfer,
--   eOffice-approved promotion, eOffice-approved transfer) ignored their own
--   effectiveDate and mutated the employee master the moment the order was
--   recorded/approved. Such rows now sit in this new 'pending_effective'
--   status until the daily scheduler tick (lifecycle/effective-scheduler.ts,
--   job_name 'hrms_lifecycle_effective_changes') finds effective_date <= today
--   and moves them to 'completed', applying the change at that point. A
--   promotion/transfer whose effectiveDate is today-or-earlier at
--   creation/approval time still goes straight to 'completed' as before — see
--   lifecycle/consumer.ts, lifecycle/promotion-eoffice-consumer.ts,
--   lifecycle/eoffice-consumer.ts, employee/consumer.ts.
--
--   Also adds two narrow read-only functions (due_promotion_ids/
--   due_transfer_ids) the scheduler uses to discover which rows are due
--   ACROSS ALL TENANTS. hrms_svc (this service's connecting role) does not
--   have BYPASSRLS by design (packages/db/src/tenant-scope.ts's rollout doc
--   requires this), and hrms_promotions/hrms_transfers' tenant_isolation_policy
--   is a strict `tenant_id = employee.current_tenant_id()` under FORCE ROW
--   LEVEL SECURITY with no admin/bypass clause — so a plain cross-tenant
--   SELECT from hrms_svc always sees zero rows, no matter what tenant
--   context (if any) is active. (This is also why scheduler/tick.ts's own
--   listTenantIds() cross-tenant query currently returns zero tenants in
--   this environment — confirmed by running its test — a separate,
--   pre-existing regression, NOT fixed by this migration/PR.) A background
--   job that must sweep every tenant for due rows has no single tenant
--   context to scope a normal query to, so these two functions are created
--   by this migration's own role (civitas_admin, which has BYPASSRLS) and
--   marked SECURITY DEFINER: they run with that bypass internally regardless
--   of the caller's role, but return ONLY (id, tenant_id) — enough for the
--   scheduler to then re-enter each row's own tenant context and perform the
--   actual transition/apply through the normal, fully tenant-scoped,
--   RLS-enforced path (lifecycle/repo.ts's transitionPromotion/
--   transitionTransfer + applyPromotionEffect/applyTransferEffect) — never
--   any employee/pay data.
--
-- Rollback: DROP FUNCTION lifecycle.due_promotion_ids(date),
--   lifecycle.due_transfer_ids(date); then DROP CONSTRAINT and re-ADD using
--   migration 0042's value lists (only safe once no row has status =
--   'pending_effective').
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- ============================================================================
-- lifecycle.hrms_transfers.status — add 'pending_effective'
-- ============================================================================
ALTER TABLE lifecycle.hrms_transfers
  DROP CONSTRAINT IF EXISTS hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_transfers
  ADD CONSTRAINT hrms_transfers_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'completed', 'cancelled',
    'requested', 'ordered', 'relieved', 'joined', 'pending_approval',
    'pending_effective'
  ))
  NOT VALID;

-- ============================================================================
-- lifecycle.hrms_promotions.status — add 'pending_effective'
-- ============================================================================
ALTER TABLE lifecycle.hrms_promotions
  DROP CONSTRAINT IF EXISTS hrms_promotions_status_check;
ALTER TABLE lifecycle.hrms_promotions
  ADD CONSTRAINT hrms_promotions_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'cancelled', 'pending_approval',
    'completed', 'pending_effective'
  ))
  NOT VALID;

-- ============================================================================
-- VALIDATE (separate pass, matches 0035/0042 convention)
-- ============================================================================
ALTER TABLE lifecycle.hrms_transfers VALIDATE CONSTRAINT hrms_transfers_status_check;
ALTER TABLE lifecycle.hrms_promotions VALIDATE CONSTRAINT hrms_promotions_status_check;

-- ============================================================================
-- Cross-tenant discovery functions for the effective-changes scheduler.
-- SECURITY DEFINER + owned by this migration's role (civitas_admin, which
-- has BYPASSRLS) so they see rows across every tenant regardless of the
-- caller's own tenant context; EXECUTE is granted to hrms_svc (the service's
-- normal, RLS-restricted connecting role) so the running service can call
-- them, but they return only (id, tenant_id) — never row content.
-- ============================================================================
CREATE OR REPLACE FUNCTION lifecycle.due_promotion_ids(p_run_date date)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = lifecycle, pg_temp
AS $$
  SELECT id, tenant_id FROM lifecycle.hrms_promotions
  WHERE status = 'pending_effective' AND effective_date <= p_run_date;
$$;

CREATE OR REPLACE FUNCTION lifecycle.due_transfer_ids(p_run_date date)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = lifecycle, pg_temp
AS $$
  SELECT id, tenant_id FROM lifecycle.hrms_transfers
  WHERE status = 'pending_effective' AND effective_date <= p_run_date;
$$;

REVOKE ALL ON FUNCTION lifecycle.due_promotion_ids(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifecycle.due_transfer_ids(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifecycle.due_promotion_ids(date) TO hrms_svc;
GRANT EXECUTE ON FUNCTION lifecycle.due_transfer_ids(date) TO hrms_svc;
