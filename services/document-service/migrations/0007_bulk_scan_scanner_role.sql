-- Purpose: bulk-scan dispatcher needs a CROSS-TENANT view of due work (which tenants have queued /
--          scan_pending / lease-expired files) to schedule fairly. bulk_scan.* is FORCE ROW LEVEL
--          SECURITY and document_svc is NOBYPASSRLS, so a bare cross-tenant SELECT sees zero rows.
--          This adds a dedicated READ-ONLY BYPASSRLS scanner role (same convention as the court /
--          visitor / procurement scanner roles). It can only SELECT bulk_scan.batch_files; every
--          write still goes through document_svc inside the tenant GUC, so RLS re-checks it.
-- Rollback: REVOKE ... ; DROP ROLE document_scanner;
-- Affected services: document-service only (modules/bulk-scan dispatcher + lease sweeper discovery)
-- Additive and idempotent. Safe to re-run. Requires 0005.
--
-- SECURITY (SEC-P1-09): no password literal ships here. Set `civitas.document_scanner_password`
-- from the secrets manager before running migrations in prod; when absent (local/dev) a RANDOM
-- one-time password is generated so no known credential exists for this BYPASSRLS role.
SET lock_timeout = '5s';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.document_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'document_scanner') THEN
    EXECUTE format(
      'CREATE ROLE document_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.document_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE document_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE document_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

DO $$ BEGIN
  GRANT USAGE ON SCHEMA bulk_scan TO document_scanner;
  GRANT SELECT ON bulk_scan.batch_files TO document_scanner;
END $$;
