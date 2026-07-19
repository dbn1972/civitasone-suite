-- Purpose: add a SELECT-only, additional permissive RLS policy on the two
--   tables admin-service genuinely needs to read cross-tenant for
--   (super_admin-only "list/read all tenants", platform-wide break-glass
--   review, and the break-glass TTL sweeper), gated by a GUC
--   (app.platform_bypass) that is ONLY ever set by trusted server-side code
--   AFTER requireSuperAdmin()/the internal sweeper job has already
--   authorized the read at the application layer — never derived from
--   client input. Postgres combines multiple permissive policies for the
--   same command with OR, so this coexists with (never replaces) the
--   existing strict `tenant_id = current_tenant_id()` policy: SELECT is
--   allowed if EITHER the strict per-tenant match holds OR the bypass GUC
--   is set for this transaction. INSERT/UPDATE/DELETE are UNCHANGED and
--   still governed solely by the strict tenant-match policy (no bypass
--   policy is added for those commands), so writes can never skip tenant
--   scoping even if app.platform_bypass is accidentally left set.
--
--   Root cause this fixes: an HTTP request's RLS GUC is set from the
--   CALLER's own JWT tenant (onRequest hook), so a super_admin's genuinely
--   cross-tenant queries (GET /v1/admin/tenants, GET /v1/admin/breakglass)
--   were silently filtered down to just the caller's own tenant under
--   strict RLS equality — no error, just wrong (empty-looking) data. The
--   break-glass TTL sweeper (a bare setInterval job with no per-request
--   tenant at all) saw zero rows for the same reason.
--
-- Rollback: DROP POLICY platform_bypass_read_policy ON tenants.admin_tenants;
--   DROP POLICY platform_bypass_read_policy ON support.admin_break_glass_log;
-- Affected services: admin-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON tenants.admin_tenants;
CREATE POLICY platform_bypass_read_policy ON tenants.admin_tenants
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

DROP POLICY IF EXISTS platform_bypass_read_policy ON support.admin_break_glass_log;
CREATE POLICY platform_bypass_read_policy ON support.admin_break_glass_log
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
