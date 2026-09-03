-- 0039_sweep_task_tenants_bypassrls_owner.sql
-- Fix: workflow.sweep_task_tenants() has ALWAYS returned zero rows, so the
-- SLA-escalation, pre-breach-reminder, and deemed-approval-timer sweepers
-- (tasks/sweeper.ts's sweepOverdueTasks / sweepReminders / sweepTimerTasks,
-- all three run off forEachTaskTenant() -> sweepTaskTenants()) have silently
-- never fired in production.
--
-- ROOT CAUSE: migration 0029 created sweep_task_tenants() as SECURITY DEFINER
-- specifically so a cross-tenant "which tenants have pending work" scan could
-- run BEFORE any single tenant's RLS context is known (the whole point: you
-- cannot runWithTenant(tenantId, ...) to discover tenantId). But SECURITY
-- DEFINER only grants the DEFINER's privileges -- it does NOT bypass a FORCE
-- ROW LEVEL SECURITY policy unless the definer role itself has BYPASSRLS.
-- workflow.tasks is FORCE ROW LEVEL SECURITY (relforcerowsecurity=true), and
-- the function's owner (workflow_svc) is deliberately NOBYPASSRLS (#146). So
-- every invocation -- always made from a bare connection with no
-- app.tenant_id GUC set -- evaluates the RLS policy's `tenant_id =
-- workflow.current_tenant_id()` against a NULL current_tenant_id() and
-- matches nothing, regardless of how many pending tasks actually exist.
-- Verified empirically against a fresh cluster: a task seeded with
-- status='pending' and a real tenant_id is invisible to
-- `SELECT workflow.sweep_task_tenants()`.
--
-- This is the exact bug migration 0033 (workflow_scanner_role) already fixed
-- for the outbox relay + scheduled purge, which used to rely on the same
-- broken SECURITY-DEFINER-owned-by-a-non-BYPASSRLS-role pattern via
-- outbox_pending_tenants()/outbox_purgeable_tenants(). That migration's fix
-- was to introduce a dedicated BYPASSRLS role (workflow_scanner) and run the
-- outbox scan AS that role. sweep_task_tenants() was never migrated to the
-- same fix, so task sweeping was left silently broken.
--
-- FIX: reassign sweep_task_tenants() to the existing workflow_scanner
-- BYPASSRLS role (0033) and grant it READ-ONLY access to workflow.tasks --
-- and ONLY workflow.tasks; workflow_scanner still cannot read, write, or
-- touch any other tenant-scoped workflow.* business table. This keeps the
-- function's own stated contract ("discloses tenant ids only, never row
-- data") intact while finally making it actually bypass RLS as designed.
-- Applied via ALTER, not DROP+CREATE, so no REVOKE EXECUTE grants are lost.
SET search_path = workflow, pg_temp;

-- Idempotent re-assert (mirrors 0033's own idempotent-rerun branch) --
-- guarantees this migration also runs with superuser privilege via this
-- script's needs_superuser() router, which ALTER FUNCTION ... OWNER TO
-- requires (the current owner, workflow_svc, is not a member of
-- workflow_scanner and cannot reassign ownership to it unprivileged).
ALTER ROLE workflow_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA workflow TO workflow_scanner;
GRANT SELECT ON workflow.tasks TO workflow_scanner;

ALTER FUNCTION workflow.sweep_task_tenants() OWNER TO workflow_scanner;

-- ALTER FUNCTION ... OWNER TO resets the object's ACL to just the new owner
-- (verified empirically: the EXECUTE grant to workflow_svc that 0029 set up
-- was silently dropped by the owner change above) -- workflow_svc is the
-- role that actually CALLS this function from application code
-- (sweeper.ts's sweepTaskTenants()), so its EXECUTE privilege must be
-- re-asserted or every sweep starts failing with "permission denied for
-- function sweep_task_tenants" instead of silently returning zero rows.
REVOKE ALL ON FUNCTION workflow.sweep_task_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow.sweep_task_tenants() TO workflow_svc;
