-- Purpose: add a SELECT-only, additional permissive RLS policy on
--   findings.findings, gated by a GUC (app.platform_bypass) that is ONLY ever
--   set by trusted server-side code (processOverdueFindings in worker.ts) —
--   never derived from client input. Postgres combines multiple permissive
--   policies for the same command with OR, so this coexists with (never
--   replaces) the existing strict `tenant_id = current_tenant_id()` policy:
--   SELECT is allowed if EITHER the strict per-tenant match holds OR the
--   bypass GUC is set for this transaction. INSERT/UPDATE/DELETE are
--   UNCHANGED and still governed solely by the strict tenant-match policy (no
--   bypass policy is added for those commands), so writes can never skip
--   tenant scoping even if app.platform_bypass is accidentally left set.
--
--   Root cause this fixes: the overdue-findings sweep (processOverdueFindings,
--   wired into worker.ts on an hourly setInterval) is a system-scheduled job
--   with no per-request tenant context at all. A bare db.execute()/
--   db.transaction() sets no `app.tenant_id` GUC, so the strict
--   tenant_isolation policy's `tenant_id = current_tenant_id()` check never
--   matched (current_tenant_id() is NULL under no GUC) — the sweep silently
--   found (and escalated) ZERO overdue findings in every environment since it
--   was introduced. Fixed with the same per-tenant-loop pattern used by
--   admin-service's migration 0011 and audit-service's migration 0021: step 1
--   finds candidate TENANT IDS ONLY via this scoped platform-bypass read
--   (minimal blast radius — ids, not rows; see findOverdueFindingTenantIds in
--   modules/findings/repo.ts), step 2 loops per tenant id and does the actual
--   overdue lookup + state-transition UPDATE under that tenant's own
--   strict-RLS GUC via runWithTenant (worker.ts's processOverdueFindings).
--
-- Rollback: DROP POLICY platform_bypass_read_policy ON findings.findings;
-- Affected services: inspection-service

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON findings.findings;
CREATE POLICY platform_bypass_read_policy ON findings.findings
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
