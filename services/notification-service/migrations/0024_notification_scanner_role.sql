-- 0024_notification_scanner_role.sql
-- Cross-tenant maintenance scanner role for notification-service sweepers.
--
-- WHY: notification domain tables are FORCE ROW LEVEL SECURITY (0007) and the
-- service connects as the least-privilege role notification_svc (NOBYPASSRLS,
-- flipped by #146). The tenant policies mean a bare SELECT with no app.tenant_id
-- GUC set returns ZERO rows. The sweepers (delivery retry P1-2, schedule
-- dispatch, digest flush, DND release) legitimately need to scan ALL tenants to
-- find due work; without this role their discovery SELECT silently returned 0
-- rows in production, so every sweep no-oped.
--
-- SECURITY: this role is READ-ONLY (SELECT only). All WRITES still go through
-- notification_svc inside runWithTenant(row.tenantId, ...) so RLS re-checks
-- every mutation. The scanner never writes. Mirrors meeting-service migration
-- 0007_meeting_scanner_role.sql (same password-GUC convention, SEC-P1-09: no
-- password literal ships in this migration).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.notification_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_scanner') THEN
    EXECUTE format(
      'CREATE ROLE notification_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.notification_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE notification_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE notification_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA templates TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA templates TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA templates
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA deliveries TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA deliveries TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA deliveries
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA channels TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA channels TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA channels
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA alerts TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA alerts TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA alerts
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA bulk TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA bulk TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA bulk
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA stream TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA stream TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA stream
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA scheduling TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA scheduling TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA scheduling
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA digest TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA digest TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA digest
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA webhook TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA webhook TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA webhook
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA analytics TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA analytics
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA dnd TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA dnd TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA dnd
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA i18n TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA i18n TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA i18n
  GRANT SELECT ON TABLES TO notification_scanner;
GRANT USAGE ON SCHEMA segments TO notification_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA segments TO notification_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE notification_svc IN SCHEMA segments
  GRANT SELECT ON TABLES TO notification_scanner;

-- L1 isolation (DB-per-service) revokes PUBLIC CONNECT on this database; the
-- scanner must be able to connect to THIS service database (read-only role).
DO $$
BEGIN
  EXECUTE format(GRANT CONNECT ON DATABASE %I TO notification_scanner, current_database());
END
$$;
