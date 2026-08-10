-- 0041_notification_scanner_default_privileges_owner_fix.sql
-- Close the ALTER DEFAULT PRIVILEGES owner-role gap for notification_scanner.
--
-- PURPOSE
-- 0024_notification_scanner_role.sql ends with statements of the form:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA <schema>
--     GRANT SELECT ON TABLES TO notification_scanner;
--
-- Default privileges are keyed to the role that CREATES the object, so that
-- rule only fires for tables created by notification_svc. On every deployed
-- host these tables are created by the migration runner, which connects as
-- civitas_admin (see scripts/dev/migrate-all.mjs) -- verified against the live
-- database, where all existing tables report owner=civitas_admin. The rule
-- therefore never fires.
--
-- Nothing is broken today because 0024_notification_scanner_role.sql also issues an explicit
-- GRANT SELECT ON ALL TABLES, covering the tables existing at that point. The
-- gap is latent: any table added by a LATER migration gets no grant, and the
-- cross-tenant scanner/sweeper then fails at RUNTIME (silently returning zero
-- rows under FORCE RLS, or erroring permission denied) rather than failing
-- loudly at migration time.
--
-- This migration adds the missing default-privilege rule for the actual object
-- owner, and re-asserts the explicit grant so the two stay consistent.
--
-- The original FOR ROLE notification_svc rule is deliberately NOT dropped: if
-- some environment does create tables as notification_svc, that rule remains
-- correct for it. Both rules coexist harmlessly.
--
-- AFFECTED SERVICES
--   notification-service (schemas: templates, deliveries, channels, alerts, bulk, stream, scheduling, digest, webhook, analytics, dnd, i18n, segments)
--
-- Additive and idempotent; safe to re-run. ALTER DEFAULT PRIVILEGES and GRANT
-- are declarative -- re-running converges to the same state.
--
-- ROLLBACK
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA templates
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA deliveries
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA channels
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA alerts
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA bulk
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA stream
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA scheduling
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA digest
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA webhook
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA analytics
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA dnd
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA i18n
--     REVOKE SELECT ON TABLES FROM notification_scanner;
--   ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA segments
--     REVOKE SELECT ON TABLES FROM notification_scanner;

SET lock_timeout = '5s';

-- Only act when the scanner role exists; on a host where the original
-- scanner migration has not run yet this is a harmless no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_scanner') THEN
    RAISE NOTICE 'role notification_scanner absent - skipping default privilege fix';
    RETURN;
  END IF;

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA templates GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA templates TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA deliveries GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA deliveries TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA channels GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA channels TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA alerts GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA alerts TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA bulk GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bulk TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA stream GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA stream TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA scheduling GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA scheduling TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA digest GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA digest TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA webhook GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA webhook TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA analytics GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA dnd GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA dnd TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA i18n GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA i18n TO notification_scanner';

  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE civitas_admin IN SCHEMA segments GRANT SELECT ON TABLES TO notification_scanner';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA segments TO notification_scanner';
END
$$;
