-- 0019_project_scanner_role.sql
-- Cross-tenant maintenance scanner role for the project-service RAG sweep.
--
-- WHY: project domain tables are FORCE ROW LEVEL SECURITY and the service
-- connects as the least-privilege role project_svc (NOBYPASSRLS, flipped by
-- #146). The RAG scheduler (runRagTick) legitimately scans active projects
-- across ALL tenants; without this role its discovery SELECT silently returned
-- 0 rows in production, so the sweep no-oped.
--
-- SECURITY: this role is READ-ONLY (SELECT only). All WRITES still go through
-- project_svc inside runWithTenant(project.tenantId, ...) so RLS re-checks
-- every mutation. Mirrors meeting-service migration 0007 (same password-GUC
-- convention, SEC-P1-09: no password literal ships in this migration).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.project_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_scanner') THEN
    EXECUTE format(
      'CREATE ROLE project_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.project_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE project_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE project_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA project TO project_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA project TO project_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA project
  GRANT SELECT ON TABLES TO project_scanner;
GRANT USAGE ON SCHEMA scheme TO project_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA scheme TO project_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA scheme
  GRANT SELECT ON TABLES TO project_scanner;
GRANT USAGE ON SCHEMA progress TO project_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA progress TO project_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA progress
  GRANT SELECT ON TABLES TO project_scanner;
GRANT USAGE ON SCHEMA utilisation TO project_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA utilisation TO project_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA utilisation
  GRANT SELECT ON TABLES TO project_scanner;
GRANT USAGE ON SCHEMA geo TO project_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA geo TO project_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE project_svc IN SCHEMA geo
  GRANT SELECT ON TABLES TO project_scanner;

-- L1 isolation (DB-per-service) may revoke PUBLIC CONNECT on this database;
-- the scanner must be able to connect to THIS service database (read-only).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO project_scanner', current_database());
END
$$;
