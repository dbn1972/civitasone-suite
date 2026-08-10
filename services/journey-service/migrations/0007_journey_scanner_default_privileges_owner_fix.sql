-- 0007_journey_scanner_default_privileges_owner_fix.sql
-- Close the ALTER DEFAULT PRIVILEGES owner-role gap for journey_scanner.
--
-- PURPOSE
-- 0006_journey_scanner_role.sql ends with statements of the form:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE journey_svc IN SCHEMA <schema>
--     GRANT SELECT ON TABLES TO journey_scanner;
--
-- Default privileges are keyed to the role that CREATES the object, so that
-- rule only fires for tables created by journey_svc. On every deployed
-- host these tables are created by the migration runner, which connects as
-- civitas_admin (see scripts/dev/migrate-all.mjs) -- verified against the live
-- database, where all existing tables report owner=civitas_admin. The rule
-- therefore never fires.
--
-- Nothing is broken today because 0006_journey_scanner_role.sql also issues an explicit
-- GRANT SELECT ON ALL TABLES, covering the tables existing at that point. The
-- gap is latent: any table added by a LATER migration gets no grant, and the
-- cross-tenant scanner/sweeper then fails at RUNTIME (silently returning zero
-- rows under FORCE RLS, or erroring permission denied) rather than failing
-- loudly at migration time.
--
-- This migration adds the missing default-privilege rule for the actual object
-- owner, and re-asserts the explicit grant so the two stay consistent.
--
-- The original FOR ROLE journey_svc rule is deliberately NOT dropped: if
-- some environment does create tables as journey_svc, that rule remains
-- correct for it. Both rules coexist harmlessly.
--
-- AFFECTED SERVICES
--   journey-service (schemas: journey)
--
-- Additive and idempotent; safe to re-run. ALTER DEFAULT PRIVILEGES and GRANT
-- are declarative -- re-running converges to the same state.
--
-- ROLLBACK
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA journey
--     REVOKE SELECT ON TABLES FROM journey_scanner;

SET lock_timeout = '5s';

-- Only act when the scanner role exists; on a host where the original
-- scanner migration has not run yet this is a harmless no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_scanner') THEN
    RAISE NOTICE 'role journey_scanner absent - skipping default privilege fix';
    RETURN;
  END IF;

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA journey GRANT SELECT ON TABLES TO journey_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA journey TO journey_scanner';
END
$$;
