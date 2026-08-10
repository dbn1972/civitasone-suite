-- 0021_project_scanner_default_privileges_owner_fix.sql
-- Close the ALTER DEFAULT PRIVILEGES owner-role gap for project_scanner.
--
-- PURPOSE
-- 0019_project_scanner_role.sql ends with statements of the form:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA <schema>
--     GRANT SELECT ON TABLES TO project_scanner;
--
-- Default privileges are keyed to the role that CREATES the object, so that
-- rule only fires for tables created by project_svc. On every deployed
-- host these tables are created by the migration runner, which connects as
-- civitas_admin (see scripts/dev/migrate-all.mjs) -- verified against the live
-- database, where all existing tables report owner=civitas_admin. The rule
-- therefore never fires.
--
-- Nothing is broken today because 0019_project_scanner_role.sql also issues an explicit
-- GRANT SELECT ON ALL TABLES, covering the tables existing at that point. The
-- gap is latent: any table added by a LATER migration gets no grant, and the
-- cross-tenant scanner/sweeper then fails at RUNTIME (silently returning zero
-- rows under FORCE RLS, or erroring permission denied) rather than failing
-- loudly at migration time.
--
-- This migration adds the missing default-privilege rule for the actual object
-- owner, and re-asserts the explicit grant so the two stay consistent.
--
-- The original FOR ROLE project_svc rule is deliberately NOT dropped: if
-- some environment does create tables as project_svc, that rule remains
-- correct for it. Both rules coexist harmlessly.
--
-- AFFECTED SERVICES
--   project-service (schemas: project, scheme, progress, utilisation, geo)
--
-- Additive and idempotent; safe to re-run. ALTER DEFAULT PRIVILEGES and GRANT
-- are declarative -- re-running converges to the same state.
--
-- ROLLBACK
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA project
--     REVOKE SELECT ON TABLES FROM project_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA scheme
--     REVOKE SELECT ON TABLES FROM project_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA progress
--     REVOKE SELECT ON TABLES FROM project_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA utilisation
--     REVOKE SELECT ON TABLES FROM project_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA geo
--     REVOKE SELECT ON TABLES FROM project_scanner;

SET lock_timeout = '5s';

-- Only act when the scanner role exists; on a host where the original
-- scanner migration has not run yet this is a harmless no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_scanner') THEN
    RAISE NOTICE 'role project_scanner absent - skipping default privilege fix';
    RETURN;
  END IF;

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA project GRANT SELECT ON TABLES TO project_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA project TO project_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA scheme GRANT SELECT ON TABLES TO project_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA scheme TO project_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA progress GRANT SELECT ON TABLES TO project_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA progress TO project_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA utilisation GRANT SELECT ON TABLES TO project_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA utilisation TO project_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA geo GRANT SELECT ON TABLES TO project_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA geo TO project_scanner';
END
$$;
