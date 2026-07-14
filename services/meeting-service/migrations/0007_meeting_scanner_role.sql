-- 0007_meeting_scanner_role.sql
-- Cross-tenant maintenance scanner role for meeting-service scheduled workers.
--
-- WHY: meeting.* tables are FORCE ROW LEVEL SECURITY (0005_meeting_rls_force) and
-- the service connects as the least-privilege role meeting_svc (NOBYPASSRLS). The
-- tenant policies (tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid)
-- mean a bare SELECT with no GUC set returns ZERO rows. The scheduled workers
-- (tenure-expiry, action-item-escalation, statutory-frequency-check) legitimately
-- need to scan ALL tenants to find work; before this change their cross-tenant
-- discovery SELECT (a plain db.select() with no tenant transaction) silently
-- returned 0 rows in production, so every sweep no-oped.
--
-- SECURITY: this role is READ-ONLY (SELECT only). All WRITES still go through
-- meeting_svc inside runWithTenant(row.tenantId, ...) so RLS re-checks every
-- mutation. The scanner never writes.
--
-- The app wires a second pool via MEETING_SCANNER_DATABASE_URL (see
-- src/shared/scanner-db.ts); when unset it falls back to DATABASE_URL (safe in dev
-- where the service connects as the RLS-inert superuser).
--
-- SECURITY (SEC-P1-09): no password literal ships in this migration. The
-- password is taken from the `civitas.meeting_scanner_password` GUC — set it
-- from your secrets manager BEFORE running migrations, e.g.
--   PGOPTIONS="-c civitas.meeting_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is generated so
-- no known credential exists for this BYPASSRLS role (dev connects as the
-- superuser, so the scanner login password is not used there anyway). PROD may
-- still rotate later: ALTER ROLE meeting_scanner PASSWORD '<from-secrets>';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.meeting_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_scanner') THEN
    EXECUTE format(
      'CREATE ROLE meeting_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.meeting_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE meeting_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE meeting_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA meeting TO meeting_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA meeting TO meeting_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE meeting_svc IN SCHEMA meeting
  GRANT SELECT ON TABLES TO meeting_scanner;
