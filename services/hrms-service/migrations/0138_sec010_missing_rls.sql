-- Migration: 0138_sec010_missing_rls.sql
-- Purpose: SEC-010 -- five tables created after hrms-service's RLS isolation
--          sweeps (0026_rls_tenant_isolation.sql / 0034_rls_full_tenant_isolation.sql
--          and later completion passes) never got row-level security at all --
--          not even ENABLE. hrms_svc is NOBYPASSRLS and owns these tables (per-service
--          migrations run as the service role by default -- see
--          scripts/ci/bootstrap-postgres.sh's SERVICE_DBS loop), so without FORCE,
--          RLS would additionally be silently bypassed for the very role that
--          serves every request even if ENABLE alone were added.
-- RLS: same convention as the rest of hrms-service -- employee.current_tenant_id(),
--      ENABLE + FORCE + tenant_isolation_policy (USING + WITH CHECK). Mirrors
--      0034_rls_full_tenant_isolation.sql, 0123_rls_completeness.sql, and most
--      recently 0135_audit_hr_action_log.sql (which reuses employee.current_tenant_id()
--      for a table outside the employee schema, exactly as this migration does for
--      the two attendance-schema tables below).
-- Tables (schema.table -- originating migration):
--   attendance.hrms_wfh_requests            (0107_wfh_shift_tables.sql)
--   attendance.hrms_shift_change_requests   (0107_wfh_shift_tables.sql)
--   employee.hrms_audit_log                 (0109_audit_log_table.sql)
--   employee.integrations                   (0061_integrations_schema.sql)
--   employee.integration_sync_log           (0061_integrations_schema.sql)
-- Companion app-layer fix (this migration alone is NOT sufficient -- see PR):
--   - src/modules/attendance/routes.ts: GET /v1/hrms/shift-requests and
--     GET /v1/hrms/wfh-requests used bare db.select() (no app.tenant_id GUC).
--     Under FORCE RLS that fails closed to ZERO rows for every tenant (see
--     shared/db.ts's own doc comment on scopedRead). Wrapped in scopedRead().
--   - src/modules/integration/routes.ts: all 5 endpoints used sqlPool.query()
--     (bare pool-tier client, no GUC). Under FORCE RLS the INSERT/UPDATE would
--     fail closed (WITH CHECK violation) and the SELECTs would silently return
--     zero rows. Converted to db.transaction()-scoped queries.
--   - employee.hrms_audit_log has NO current callers anywhere in hrms-service
--     (checked: no insert/select of hrmsAuditLog outside its own definition
--     file) -- FORCE RLS here carries zero regression risk today, but note it
--     is dead code, same class of gap as TX-013 (audit.hr_action_log) before
--     that migration; flagged, not fixed here (out of SEC-010's scope).
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER TABLE <table> DISABLE ROW LEVEL SECURITY; then
--           DROP POLICY tenant_isolation_policy ON <table>; for each table below.
-- Affected services: hrms-service

SET lock_timeout = '5s';

-- current_tenant_id() is created by earlier migrations (0026/0034); guard so
-- this migration never needs to own it (mirrors admin-service's 0029 idiom).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'current_tenant_id' AND n.nspname = 'employee'
  ) THEN
    CREATE FUNCTION employee.current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── attendance.hrms_wfh_requests ────────────────────────────────────────────
ALTER TABLE attendance.hrms_wfh_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_wfh_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_wfh_requests;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_wfh_requests;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_wfh_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── attendance.hrms_shift_change_requests ───────────────────────────────────
ALTER TABLE attendance.hrms_shift_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.hrms_shift_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON attendance.hrms_shift_change_requests;
DROP POLICY IF EXISTS tenant_isolation ON attendance.hrms_shift_change_requests;
CREATE POLICY tenant_isolation_policy ON attendance.hrms_shift_change_requests
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── employee.hrms_audit_log ──────────────────────────────────────────────────
ALTER TABLE employee.hrms_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.hrms_audit_log;
DROP POLICY IF EXISTS tenant_isolation ON employee.hrms_audit_log;
CREATE POLICY tenant_isolation_policy ON employee.hrms_audit_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── employee.integrations ────────────────────────────────────────────────────
ALTER TABLE employee.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.integrations;
DROP POLICY IF EXISTS tenant_isolation ON employee.integrations;
CREATE POLICY tenant_isolation_policy ON employee.integrations
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());

-- ── employee.integration_sync_log ────────────────────────────────────────────
ALTER TABLE employee.integration_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.integration_sync_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON employee.integration_sync_log;
DROP POLICY IF EXISTS tenant_isolation ON employee.integration_sync_log;
CREATE POLICY tenant_isolation_policy ON employee.integration_sync_log
  USING (tenant_id = employee.current_tenant_id())
  WITH CHECK (tenant_id = employee.current_tenant_id());
