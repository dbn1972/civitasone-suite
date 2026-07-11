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
-- PROD: rotate the password out-of-band from your secrets manager, e.g.
--   ALTER ROLE meeting_scanner PASSWORD '<from-secrets>';
-- The dev password below mirrors the meeting_dev_pw convention for local/test.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_scanner') THEN
    CREATE ROLE meeting_scanner LOGIN PASSWORD 'meeting_scanner_dev_pw'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE meeting_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA meeting TO meeting_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA meeting TO meeting_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE meeting_svc IN SCHEMA meeting
  GRANT SELECT ON TABLES TO meeting_scanner;
