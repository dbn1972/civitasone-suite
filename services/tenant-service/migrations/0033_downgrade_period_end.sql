-- 0033_downgrade_period_end.sql
-- OWNER DECISION F8 (2026-10-27): an APPROVED plan downgrade takes effect at the END
-- of the current billing period. Approval therefore only SCHEDULES the change:
-- effective_at is the subscription period end captured at approval; a sweeper later
-- applies every due request (applied_at / apply_outcome record what happened).
-- status stays pending/approved/rejected: approved + applied_at IS NULL means
-- "scheduled". Additive + idempotent.
SET lock_timeout = '5s';

ALTER TABLE subscriptions.downgrade_requests ADD COLUMN IF NOT EXISTS effective_at  timestamptz;
ALTER TABLE subscriptions.downgrade_requests ADD COLUMN IF NOT EXISTS applied_at    timestamptz;
ALTER TABLE subscriptions.downgrade_requests ADD COLUMN IF NOT EXISTS apply_outcome varchar(40);

CREATE INDEX IF NOT EXISTS idx_downgrade_requests_due
  ON subscriptions.downgrade_requests (effective_at)
  WHERE status = 'approved' AND applied_at IS NULL;

-- The sweeper runs across tenants (control-plane path, same pattern as 0032): it may
-- only learn WHICH approved requests are due; the apply itself is a per-tenant command
-- carried out under that tenant's own row-level security.
CREATE OR REPLACE FUNCTION subscriptions.list_due_downgrades(p_limit int)
  RETURNS TABLE (id uuid, tenant_id uuid, decided_by uuid)
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
      SELECT d.id, d.tenant_id, d.decided_by
      FROM subscriptions.downgrade_requests d
      WHERE d.status = 'approved' AND d.applied_at IS NULL AND d.effective_at <= now()
      ORDER BY d.effective_at ASC, d.id
      LIMIT greatest(least(p_limit, 200), 1);
    PERFORM set_config('app.platform_bypass', coalesce(v_prev, ''), true);
  END;
  $$;

REVOKE ALL ON FUNCTION subscriptions.list_due_downgrades(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscriptions.list_due_downgrades(int) TO tenant_svc;
