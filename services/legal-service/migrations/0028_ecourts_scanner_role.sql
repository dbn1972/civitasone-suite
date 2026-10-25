-- 0028_ecourts_scanner_role.sql
-- Purpose: cross-tenant discovery role for the e-Courts cause-list sync worker
--          (CLOS3-S5-07).
-- Affected services: legal-service
--
-- WHY: ecourts.cause_list_syncs is FORCE ROW LEVEL SECURITY with
--   USING (tenant_id = current_setting('app.tenant_id')::uuid)
-- (0015_cause_list_syncs.sql) and the service connects as legal_svc
-- (NOBYPASSRLS). The sync tick (src/modules/ecourts/sync-consumer.ts) must
-- discover tracked matters across ALL tenants. With no app.tenant_id set, that
-- read errors / returns nothing, so e-Courts sync never ran in the worker.
-- shared/scanner-db.ts opens a second pool as this role for the discovery
-- SELECT ONLY; every per-matter write then runs under
-- runWithTenant(matter.tenantId, ...) as legal_svc, so RLS (USING + WITH CHECK)
-- re-checks each mutation.
--
-- SECURITY: SELECT on exactly one table (ecourts.cause_list_syncs), no
-- INSERT/UPDATE/DELETE, no other schema. Mirrors asset-service 0026.
-- SEC-P1-09: no password literal ships here. Set the GUC
-- `civitas.legal_scanner_password` from the secrets manager before running
-- migrations in prod; when absent a RANDOM one-time password is generated.
--
-- Rollback (separate from the code revert):
--   REVOKE SELECT ON ecourts.cause_list_syncs FROM legal_scanner;
--   REVOKE USAGE ON SCHEMA ecourts FROM legal_scanner;
--   REVOKE CONNECT ON DATABASE <this db> FROM legal_scanner;
--   DROP ROLE IF EXISTS legal_scanner;

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.legal_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'legal_scanner') THEN
    EXECUTE format(
      'CREATE ROLE legal_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.legal_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE legal_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE legal_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA ecourts TO legal_scanner;
GRANT SELECT ON ecourts.cause_list_syncs TO legal_scanner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO legal_scanner', current_database());
END
$$;
