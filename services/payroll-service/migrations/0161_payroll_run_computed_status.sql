-- 0161_payroll_run_computed_status.sql
--
-- UAT L2-N3 (bundle 16): a payroll run could be approved while it was still
-- "processing". The code now ends a successful slip computation in status
-- 'computed' (ready for review and approval) and approves only from there;
-- 'processing' means the computation is still running. The status CHECK
-- (payroll_runs_status_check_extended, 0027 / 0047) already allows 'computed',
-- so no constraint changes.
--
-- Backfill: runs left at 'processing' by a computation that FINISHED before this
-- release move to 'computed', so they stay approvable. A run row is inserted
-- with version 1, and the computation pass bumps it (repo.updateRun, the only
-- writer of payroll_runs, increments version) in the same transaction that
-- writes the slips. A pass that crashed or is still running has committed
-- nothing, so its run is still at version 1 and stays 'processing' (the M1
-- resume path completes it into 'computed').
--
-- payroll_runs has FORCE ROW LEVEL SECURITY and this runs as payroll_svc
-- (NOBYPASSRLS): the tenant ids are read under the SELECT-only
-- platform_bypass_read_policy (0037), then each tenant's rows are updated
-- under its own app.tenant_id, exactly as the service writes them. Both
-- settings are transaction-local. Idempotent (a second run matches nothing).
--
-- Rollback (only after the code is rolled back; the old code treats
-- 'processing' as approvable): the same loop with
--   UPDATE payroll.payroll_runs SET status = 'processing' WHERE status = 'computed';

SET lock_timeout = '5s';

DO $$
DECLARE t uuid;
BEGIN
  PERFORM set_config('app.platform_bypass', 'true', true);
  FOR t IN
    SELECT DISTINCT tenant_id FROM payroll.payroll_runs
     WHERE status = 'processing' AND version >= 2
  LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE payroll.payroll_runs
       SET status = 'computed', updated_at = NOW(), version = version + 1
     WHERE tenant_id = t AND status = 'processing' AND version >= 2;
  END LOOP;
  PERFORM set_config('app.platform_bypass', 'false', true);
  PERFORM set_config('app.tenant_id', '', true);
END $$;
