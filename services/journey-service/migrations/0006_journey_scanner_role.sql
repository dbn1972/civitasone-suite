-- 0006_journey_scanner_role.sql
-- Cross-tenant read-only scanner role for the journey-service wait sweeper.
--
-- WHY: journey.* tables are FORCE ROW LEVEL SECURITY and the service connects as
-- the least-privilege role journey_svc (NOBYPASSRLS). The tenant isolation policy
-- (tenant_id = current_setting('app.tenant_id')::uuid) means a bare SELECT with no
-- GUC set returns ZERO rows. The wait sweeper (src/modules/steps/sweeper.ts) has no
-- tenant context of its own — it must scan ALL tenants to find `wait` steps whose
-- resume_at has elapsed. Without a BYPASSRLS role that scan silently returns
-- nothing and every parked wait step stays parked forever, so any journey
-- containing a `wait` step never advances past it.
--
-- SECURITY: this role is READ-ONLY (SELECT only). The sweeper performs no writes
-- at all — it republishes a per-tenant resume command, and the consumer applies
-- the write on journey_svc inside the tenant-scoped transaction, so RLS re-checks
-- every mutation. The scanner never writes.
--
-- The app wires a second pool via JOURNEY_SCANNER_DATABASE_URL (see
-- src/shared/scanner-db.ts); when unset it falls back to DATABASE_URL, which is
-- safe only in dev where the service connects as the RLS-inert superuser.
--
-- No password literal ships in this migration. The password is taken from the
-- `civitas.journey_scanner_password` GUC — set it from your secrets manager
-- BEFORE running migrations, e.g.
--   PGOPTIONS="-c civitas.journey_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev) a RANDOM one-time password is generated so no
-- known credential exists for this BYPASSRLS role. Production may rotate later:
--   ALTER ROLE journey_scanner PASSWORD '<from-secrets>';
--
-- Additive and idempotent; safe to re-run.
--
-- Rollback:
--   REVOKE ALL ON ALL TABLES IN SCHEMA journey FROM journey_scanner;
--   REVOKE USAGE ON SCHEMA journey FROM journey_scanner;
--   DROP ROLE IF EXISTS journey_scanner;

SET lock_timeout = '5s';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.journey_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_scanner') THEN
    EXECUTE format(
      'CREATE ROLE journey_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.journey_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE journey_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE journey_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA journey TO journey_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA journey TO journey_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE journey_svc IN SCHEMA journey
  GRANT SELECT ON TABLES TO journey_scanner;
