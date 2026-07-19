-- Purpose: add a SELECT-only, additional permissive RLS policy on
--   compliance.audit_pending_register, gated by a GUC (app.platform_bypass)
--   that is ONLY ever set by trusted server-side code (the ageing sweep job
--   in modules/compliance/jobs.ts) — never derived from client input.
--
--   Root cause this fixes: the ageing sweep (runAgeingSweep, wired into
--   worker.ts) is a system-scheduled job with no per-request tenant
--   context at all. A bare db.transaction() sets no app.tenant_id GUC, so
--   the strict tenant_isolation_policy's `tenant_id = current_tenant_id()`
--   check never matched (current_tenant_id() is NULL under no GUC) — the
--   sweep has silently found and flipped ZERO overdue rows in every
--   environment since it was introduced.
--
--   Postgres combines multiple permissive policies for the same command
--   with OR, so this coexists with (never replaces) the existing strict
--   per-tenant-match policy: SELECT is allowed if EITHER the strict match
--   holds OR the bypass GUC is set for this transaction. INSERT/UPDATE/
--   DELETE are UNCHANGED and still governed solely by the strict
--   tenant-match policy (no bypass policy added for those commands), so
--   the actual status-flip UPDATE can never skip tenant scoping even if
--   app.platform_bypass is accidentally left set — see
--   shared/db.ts's scopedPlatformRead() doc comment and
--   modules/compliance/jobs.ts's per-tenant-loop implementation (mirrors
--   admin-service's migration 0011 / scopedPlatformRead pattern exactly).
--
-- Rollback: DROP POLICY platform_bypass_read_policy ON compliance.audit_pending_register;
-- Affected services: audit-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON compliance.audit_pending_register;
CREATE POLICY platform_bypass_read_policy ON compliance.audit_pending_register
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
