-- 0009_scanner_role.sql
-- Cross-tenant maintenance scanner role for visitor-service scheduled workers.
--
-- WHY: visitor.* tables are FORCE ROW LEVEL SECURITY and the service connects as
-- the least-privilege role visitor_svc (NOBYPASSRLS). The tenant_isolation_policy
-- (tenant_id = current_setting('app.tenant_id')::uuid) means a bare SELECT with no
-- GUC set returns ZERO rows. The 9 scheduled workers (DPDP purge, no-show,
-- overstay, nightly-aggregation, auto-reject, recurring-pass-expiry,
-- waiting-reminder, device health, image-cleanup) legitimately need to scan ALL
-- tenants to find work, so they read through this dedicated BYPASSRLS role.
--
-- SECURITY: this role is READ-ONLY (SELECT only). All WRITES still go through
-- visitor_svc inside runWithTenant(row.tenantId, ...) so RLS re-checks every
-- mutation. The scanner never writes.
--
-- The app wires a second pool via VISITOR_SCANNER_DATABASE_URL (see
-- src/shared/scanner-db.ts); when unset it falls back to DATABASE_URL (safe in
-- dev where the service connects as the RLS-inert superuser).
--
-- PROD: rotate the password out-of-band from your secrets manager, e.g.
--   ALTER ROLE visitor_scanner PASSWORD '<from-secrets>';
-- The dev password below mirrors the visitor_dev_pw convention for local/test.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visitor_scanner') THEN
    CREATE ROLE visitor_scanner LOGIN PASSWORD 'visitor_scanner_dev_pw'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE visitor_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA visitor TO visitor_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA visitor TO visitor_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE visitor_svc IN SCHEMA visitor
  GRANT SELECT ON TABLES TO visitor_scanner;
