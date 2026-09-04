-- Purpose: add a SELECT-only, additional permissive RLS policy (gated by the
--   `app.platform_bypass` GUC) on employee.hrms_employees, the only hrms
--   table services/inventory-service/tests/data-quality.test.ts reads
--   (DQ-HRMS-*). Mirrors admin-service's migration 0011 / audit-service's
--   migration 0021 (scopedPlatformRead pattern) exactly: `app.platform_bypass`
--   is ONLY ever set by trusted, hardcoded, no-user-input test/CI code
--   (data-quality.test.ts's connect() helper) — never derived from client
--   input. Postgres combines multiple permissive policies for the same
--   command with OR, so this coexists with (never replaces) the existing
--   strict tenant_isolation policy: SELECT is allowed if EITHER the strict
--   per-tenant match holds OR the bypass GUC is set for this connection.
--   INSERT/UPDATE/DELETE are UNCHANGED and still governed solely by the
--   strict tenant-match policy — this suite never writes, but the safety
--   margin is structural, not merely behavioral.
--
--   Root cause this fixes: civitas_admin is deliberately NOSUPERUSER
--   NOBYPASSRLS (bootstrap_admin_role.sql) and employee.hrms_employees has
--   FORCE ROW LEVEL SECURITY keyed on current_tenant_id(). connect() never
--   set app.tenant_id, so every DQ-HRMS-* check silently saw zero rows
--   regardless of actual content.
--
-- Rollback: DROP POLICY platform_bypass_read_policy ON employee.hrms_employees;
-- Affected services: hrms-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON employee.hrms_employees;
CREATE POLICY platform_bypass_read_policy ON employee.hrms_employees
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
