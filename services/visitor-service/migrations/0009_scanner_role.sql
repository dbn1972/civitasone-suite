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
-- SECURITY (SEC-P1-09): no password literal ships in this migration. The
-- password is taken from the `civitas.visitor_scanner_password` GUC — set it
-- from your secrets manager BEFORE running migrations, e.g.
--   PGOPTIONS="-c civitas.visitor_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is generated so
-- no known credential exists for this BYPASSRLS role (dev connects as the
-- superuser, so the scanner login password is not used there anyway). PROD may
-- still rotate later: ALTER ROLE visitor_scanner PASSWORD '<from-secrets>';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.visitor_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visitor_scanner') THEN
    EXECUTE format(
      'CREATE ROLE visitor_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.visitor_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE visitor_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE visitor_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA visitor TO visitor_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA visitor TO visitor_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE visitor_svc IN SCHEMA visitor
  GRANT SELECT ON TABLES TO visitor_scanner;
