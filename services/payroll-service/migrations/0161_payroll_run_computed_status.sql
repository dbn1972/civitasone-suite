-- 0161_payroll_run_computed_status.sql
--
-- UAT L2-N3 (bundle 16): a payroll run could be approved while it was still
-- "processing". The code now ends a successful slip computation in status
-- 'computed' (ready for review and approval) and approves only from there;
-- 'processing' means the computation is still running. The status CHECK
-- (payroll_runs_status_check_extended, 0027 / 0047) already allows 'computed'.
--
-- Backfill of runs the OLD code left at 'processing' after their pass finished.
-- "Finished" = version >= 2 OR updated_at > created_at: insertRun never sets
-- updated_at (it equals created_at until the pass's final updateRun, which is
-- written in the same transaction as the slips), and repo.updateRun only bumps
-- version since 2026-10-29, so older finished runs are still version 1. A pass
-- that crashed or is still running has committed nothing and matches neither.
--  - finished WITH slips      -> 'computed' (reviewable / approvable);
--  - finished with NO slips   -> 'failed', last_error 'no payslips computed
--    (migration 0161)' (ERP-head decision: a zero-slip run is never made
--    approvable; failed releases its period and can be reverted);
--  - never computed           -> stays 'processing' (the M1 resume completes it,
--    or a payroll admin marks it failed after PAYROLL_STUCK_RUN_HOURS via
--    PATCH /v1/payroll/runs/:id/fail-stuck).
-- A NOTICE reports how many runs moved to each status (counts only, no PII).
--
-- DEPLOY: re-run this migration once after the payroll workers have restarted
-- on the new code, to catch any pass the OLD code finished in between (it
-- leaves the run at processing). It is idempotent: a second run moves nothing.
--
-- payroll_runs / payroll_slips have FORCE ROW LEVEL SECURITY and this runs as
-- payroll_svc (NOBYPASSRLS): tenant ids are read under the SELECT-only
-- platform_bypass_read_policy (0037), then each tenant's rows are updated under
-- its own app.tenant_id, as the service writes them. Both settings are
-- transaction-local and reset at the end.
--
-- Rollback (only after the code is rolled back; the old code treats
-- 'processing' as approvable): the same per-tenant loop with
--   UPDATE payroll.payroll_runs SET status = 'processing' WHERE status = 'computed';
--   UPDATE payroll.payroll_runs SET status = 'processing', last_error = NULL
--    WHERE status = 'failed' AND last_error = 'no payslips computed (migration 0161)';

SET lock_timeout = '5s';

DO $$
DECLARE
  t uuid;
  n int;
  n_computed int := 0;
  n_failed int := 0;
BEGIN
  PERFORM set_config('app.platform_bypass', 'true', true);
  FOR t IN
    SELECT DISTINCT r.tenant_id FROM payroll.payroll_runs r
     WHERE r.status = 'processing' AND (r.version >= 2 OR r.updated_at > r.created_at)
  LOOP
    PERFORM set_config('app.tenant_id', t::text, true);

    UPDATE payroll.payroll_runs r
       SET status = 'computed', updated_at = NOW(), version = r.version + 1
     WHERE r.tenant_id = t AND r.status = 'processing'
       AND (r.version >= 2 OR r.updated_at > r.created_at)
       AND EXISTS (SELECT 1 FROM payroll.payroll_slips s WHERE s.tenant_id = t AND s.run_id = r.id);
    GET DIAGNOSTICS n = ROW_COUNT;
    n_computed := n_computed + n;

    UPDATE payroll.payroll_runs r
       SET status = 'failed', last_error = 'no payslips computed (migration 0161)',
           updated_at = NOW(), version = r.version + 1
     WHERE r.tenant_id = t AND r.status = 'processing'
       AND (r.version >= 2 OR r.updated_at > r.created_at)
       AND NOT EXISTS (SELECT 1 FROM payroll.payroll_slips s WHERE s.tenant_id = t AND s.run_id = r.id);
    GET DIAGNOSTICS n = ROW_COUNT;
    n_failed := n_failed + n;
  END LOOP;
  PERFORM set_config('app.platform_bypass', 'false', true);
  PERFORM set_config('app.tenant_id', '', true);
  RAISE NOTICE '0161 payroll run backfill: % processing -> computed, % processing -> failed (no payslips)', n_computed, n_failed;
END $$;
