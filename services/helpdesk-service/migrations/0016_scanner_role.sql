-- 0016_scanner_role.sql — dedicated BYPASSRLS scanner role for cross-tenant
-- maintenance scans (mirrors visitor-service migration 0009_scanner_role.sql).
--
-- WHY: #146 flipped helpdesk_svc to NOBYPASSRLS. The SLA-breach sweeper
-- (tickets/repo.ts#findOpenForSla) and the catalogue breach sweeper
-- (catalogue/repo.ts#findOverdueOpenRequests) deliberately scan ALL tenants in
-- one query to discover due work; under FORCE ROW LEVEL SECURITY with no
-- app.tenant_id GUC those scans silently return ZERO rows, so both sweepers
-- no-op in production. This role is used for those read-only cross-tenant
-- SELECTs ONLY — every write derived from a scan runs on the primary
-- helpdesk_svc connection inside runWithTenant(row.tenantId, ...), so RLS
-- still re-checks each mutation.
--
-- SECURITY: no password literal ships in this migration. The password is taken
-- from the `civitas.helpdesk_scanner_password` GUC — set it from your secrets
-- manager BEFORE running migrations, e.g.
--   PGOPTIONS="-c civitas.helpdesk_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is generated so
-- no known credential exists for this BYPASSRLS role. PROD may still rotate
-- later: ALTER ROLE helpdesk_scanner PASSWORD '<from-secrets>';

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.helpdesk_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helpdesk_scanner') THEN
    EXECUTE format(
      'CREATE ROLE helpdesk_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.helpdesk_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE helpdesk_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE helpdesk_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA helpdesk TO helpdesk_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA helpdesk TO helpdesk_scanner;
-- Future tables created by the schema owner are auto-granted SELECT.
ALTER DEFAULT PRIVILEGES FOR ROLE helpdesk_svc IN SCHEMA helpdesk
  GRANT SELECT ON TABLES TO helpdesk_scanner;
