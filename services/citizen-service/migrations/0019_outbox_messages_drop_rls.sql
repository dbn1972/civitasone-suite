-- T1-01: drop FORCE/RLS on _outbox.messages only (service-internal relay)
--
-- Root cause: packages/outbox relayOnce polls unpublished rows with no
-- app.tenant_id GUC. Under FORCE RLS (tenant_id = current_tenant_id()),
-- the NOBYPASSRLS service role sees ZERO rows every cycle — permanent stall.
--
-- Pattern (proven on revenue-service 0004 / historically inspection):
-- _outbox.messages is an internal relay table. Tenant isolation is enforced
-- on domain tables at insert time and again in consumers via runWithTenant.
-- RLS on the outbox table itself only blocks the fleet-wide relay.
--
-- SCOPE: ONLY `_outbox.messages`. Domain-table RLS is untouched.
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

DO $body$
BEGIN
  IF to_regclass('_outbox.messages') IS NULL THEN
    RAISE NOTICE 'T1-01 skip: _outbox.messages does not exist';
    RETURN;
  END IF;

  -- Drop both historical policy names used across the fleet
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';

  EXECUTE 'ALTER TABLE _outbox.messages NO FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE _outbox.messages DISABLE ROW LEVEL SECURITY';
END
$body$;
