-- 0014_report_scanner_role.sql
-- Cross-tenant maintenance scanner role for the report-service scheduled cron.
--
-- WHY: reports.* tables are FORCE ROW LEVEL SECURITY and the service connects
-- as the least-privilege role report_svc (NOBYPASSRLS, flipped by #146). The
-- scheduled-report cron (scheduled/cron.ts tick) legitimately scans ALL
-- tenants for due reports; without this role its discovery SELECT silently
-- no-oped in production.
--
-- SECURITY: this role is READ-ONLY (SELECT only). All WRITES still go through
-- report_svc inside runWithTenant(row.tenantId, ...) so RLS re-checks every
-- mutation. Mirrors meeting-service migration 0007 (same password-GUC
-- convention, SEC-P1-09: no password literal ships in this migration).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.report_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'report_scanner') THEN
    EXECUTE format(
      'CREATE ROLE report_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.report_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE report_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE report_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA reports TO report_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA reports TO report_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE report_svc IN SCHEMA reports
  GRANT SELECT ON TABLES TO report_scanner;

-- L1 isolation (DB-per-service) may revoke PUBLIC CONNECT on this database;
-- the scanner must be able to connect to THIS service database (read-only).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO report_scanner', current_database());
END
$$;
