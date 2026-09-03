-- 0040_sweep_subscription_tenants_bypassrls_owner.sql
-- Fix: workflow.sweep_subscription_tenants() has ALWAYS returned zero rows, so
-- the message-timeout sweep (messages/sweeper.ts's sweepExpiredMessages(),
-- which calls sweep_subscription_tenants() to discover which tenants have
-- active timeout-bearing message subscriptions before running the per-tenant
-- sweep inside runWithTenant()) has silently never fired in production.
--
-- ROOT CAUSE: identical bug shape to migration 0039's sweep_task_tenants()
-- fix. Migration 0029 created sweep_subscription_tenants() as SECURITY
-- DEFINER specifically so a cross-tenant "which tenants have pending work"
-- scan could run BEFORE any single tenant's RLS context is known. But
-- SECURITY DEFINER only grants the DEFINER's privileges -- it does NOT bypass
-- a FORCE ROW LEVEL SECURITY policy unless the definer role itself has
-- BYPASSRLS. workflow.message_subscriptions is FORCE ROW LEVEL SECURITY
-- (relforcerowsecurity=true), and the function's owner (workflow_svc) is
-- deliberately NOBYPASSRLS (#146). So every invocation -- always made from a
-- bare connection with no app.tenant_id GUC set -- evaluates the RLS policy's
-- `tenant_id = workflow.current_tenant_id()` against a NULL
-- current_tenant_id() and matches nothing, regardless of how many active
-- timeout-bearing subscriptions actually exist.
-- Verified empirically against a fresh cluster: two tenants each seeded with
-- an active message subscription (timeout_at in the past) were invisible to
-- `SELECT workflow.sweep_subscription_tenants()` run as workflow_svc, despite
-- both rows being visible to a superuser query.
--
-- This is the same bug class migration 0033 fixed for the outbox relay/purge
-- and migration 0039 fixed for sweep_task_tenants() -- flagged as a known
-- follow-up in 0039's own PR (#960) but out of scope there. This migration
-- closes that gap for sweep_subscription_tenants().
--
-- FIX: reassign sweep_subscription_tenants() to the existing workflow_scanner
-- BYPASSRLS role (0033) and grant it READ-ONLY access to
-- workflow.message_subscriptions -- and ONLY that table; workflow_scanner
-- still cannot read, write, or touch any other tenant-scoped workflow.*
-- business table. This keeps the function's own stated contract (discloses
-- tenant ids only, never row data) intact while finally making it actually
-- bypass RLS as designed. Applied via ALTER, not DROP+CREATE, so no REVOKE
-- EXECUTE grants are lost.
SET search_path = workflow, pg_temp;

-- Idempotent re-assert (mirrors 0033's/0039's own idempotent-rerun branch) --
-- guarantees this migration also runs with superuser privilege via this
-- script's needs_superuser() router, which ALTER FUNCTION ... OWNER TO
-- requires (the current owner, workflow_svc, is not a member of
-- workflow_scanner and cannot reassign ownership to it unprivileged).
ALTER ROLE workflow_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA workflow TO workflow_scanner;
GRANT SELECT ON workflow.message_subscriptions TO workflow_scanner;

ALTER FUNCTION workflow.sweep_subscription_tenants() OWNER TO workflow_scanner;

-- ALTER FUNCTION ... OWNER TO resets the object's ACL to just the new owner
-- (verified empirically by 0039 against sweep_task_tenants(): the EXECUTE
-- grant to workflow_svc that 0029 set up was silently dropped by the owner
-- change above) -- workflow_svc is the role that actually CALLS this
-- function from application code (messages/sweeper.ts's
-- sweepExpiredMessages()), so its EXECUTE privilege must be re-asserted or
-- every sweep starts failing with "permission denied for function
-- sweep_subscription_tenants" instead of silently returning zero rows.
REVOKE ALL ON FUNCTION workflow.sweep_subscription_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow.sweep_subscription_tenants() TO workflow_svc;
