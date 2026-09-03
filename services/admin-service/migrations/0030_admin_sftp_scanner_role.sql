-- 0030_admin_sftp_scanner_role.sql
-- Fix: list_sftp_lead_source_tenants() (migration 0029) is SECURITY DEFINER,
-- but SECURITY DEFINER runs with the privileges of the FUNCTION OWNER for
-- permission checks — including row-level security. The function was created
-- by admin_svc (0029 has no CREATE/ALTER ROLE, so bootstrap-postgres.sh's
-- needs_superuser() routes it to the ordinary service role, not the
-- superuser), and admin_svc is NOBYPASSRLS (0018_nobypassrls_service_roles).
-- The scheduler (scheduler.ts) calls this function with NO app.tenant_id GUC
-- set — it must scan ALL tenants to discover which ones have an sftp
-- lead-source connector configured — so current_tenant_id() is NULL and the
-- FORCE ROW LEVEL SECURITY policy on integration_settings.integration_settings
-- (tenant_id = current_tenant_id()) matches ZERO rows for every tenant. The
-- scheduled SFTP lead-ingestion sweep (BRD §9 #12) has therefore been a
-- permanent no-op in every real deployment, not just in tests.
--
-- Fix, mirroring the BYPASSRLS scanner-role convention used by 16 other
-- services (modeled here specifically on
-- notification-service/migrations/0024_notification_scanner_role.sql and
-- meeting-service/migrations/0007_meeting_scanner_role.sql — same
-- CREATE ROLE template, same civitas.<role>_password GUC convention so no
-- password literal ships in this migration, same READ-ONLY grant shape):
--
--   1. A dedicated `admin_scanner` role: LOGIN, BYPASSRLS, otherwise
--      NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT. Used for ONE thing:
--      the cross-tenant SFTP lead-source discovery read.
--   2. SELECT ONLY, narrowly scoped to the single table the discovery query
--      touches (integration_settings.integration_settings) — NOT the whole
--      schema (integration_setting_changes holds a maker-checker diff/audit
--      trail this scanner has no reason to read). admin_scanner never
--      writes; every write in this service still goes through admin_svc
--      inside the normal per-tenant GUC path, so RLS re-checks every
--      mutation exactly as before.
--   3. list_sftp_lead_source_tenants() is switched from SECURITY DEFINER to
--      SECURITY INVOKER. DEFINER was the root mistake here: it makes the
--      function ALWAYS evaluate RLS as the OWNER (admin_svc, NOBYPASSRLS)
--      regardless of which role calls it, so merely calling it over a
--      BYPASSRLS connection would not have fixed anything. INVOKER makes
--      RLS follow the CALLING role instead, matching the pattern everywhere
--      else in this codebase: a scanner role's own BYPASSRLS is what lifts
--      RLS, not function ownership. scheduler.ts is updated (this same
--      change set) to call this function over a second, admin_scanner-
--      authenticated pool (src/shared/scanner-db.ts, mirroring
--      notification-service's src/shared/scanner-db.ts) instead of the
--      primary admin_svc pool.
--
-- admin_svc keeps its existing EXECUTE grant on the function (harmless: as
-- SECURITY INVOKER, admin_svc calling it now just gets normal RLS-filtered
-- results under its own NOBYPASSRLS privileges — no escalation for admin_svc
-- at all, which is actually a tighter posture than the original DEFINER
-- design).
--
-- Additive + idempotent. Safe to re-run.
-- Rollback: ALTER FUNCTION list_sftp_lead_source_tenants() SECURITY DEFINER;
--           REVOKE ALL ON FUNCTION list_sftp_lead_source_tenants() FROM admin_scanner;
--           REVOKE ALL ON TABLE integration_settings.integration_settings FROM admin_scanner;
--           REVOKE USAGE ON SCHEMA integration_settings FROM admin_scanner;
--           DROP ROLE IF EXISTS admin_scanner; -- only if nothing else depends on it
-- Affected services: admin-service (lead-ingestion scheduler).

SET lock_timeout = '5s';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.admin_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_scanner') THEN
    EXECUTE format(
      'CREATE ROLE admin_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.admin_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE admin_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE admin_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA integration_settings TO admin_scanner;
GRANT SELECT ON TABLE integration_settings.integration_settings TO admin_scanner;

-- L1 isolation (DB-per-service) revokes PUBLIC CONNECT on some service
-- databases; belt-and-braces grant so admin_scanner can connect to THIS
-- service database regardless (mirrors notification-service 0024).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO admin_scanner', current_database());
END
$$;

-- SECURITY DEFINER → SECURITY INVOKER: see rationale above. Re-stating the
-- function body is not needed; ALTER FUNCTION changes only the security
-- attribute, leaving the existing SET search_path and body untouched.
ALTER FUNCTION list_sftp_lead_source_tenants() SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION list_sftp_lead_source_tenants() TO admin_scanner;
