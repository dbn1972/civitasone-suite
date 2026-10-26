-- 0018_knowledge_scanner_role.sql
-- Cross-tenant maintenance scanner role for the assistant-interaction retention
-- purge (UAT owner decision #16).
--
-- WHY: knowledge.* tables are FORCE ROW LEVEL SECURITY and the service connects
-- as the least-privilege role knowledge_svc (NOBYPASSRLS). The purge sweep must
-- DISCOVER which tenants have expired interactions; without this role the bare
-- cross-tenant SELECT returns zero rows and the sweep silently no-ops.
--
-- SECURITY: READ-ONLY (SELECT only). Every DELETE still runs through
-- knowledge_svc inside runWithTenant(tenantId, ...) so RLS re-checks the write.
-- Mirrors report-service migration 0014 (password via GUC, no literal shipped).

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.knowledge_scanner_password', true), ''),
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_scanner') THEN
    EXECUTE format(
      'CREATE ROLE knowledge_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    IF nullif(current_setting('civitas.knowledge_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE knowledge_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE knowledge_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA knowledge TO knowledge_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA knowledge TO knowledge_scanner;
ALTER DEFAULT PRIVILEGES FOR ROLE knowledge_svc IN SCHEMA knowledge
  GRANT SELECT ON TABLES TO knowledge_scanner;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO knowledge_scanner', current_database());
END
$$;
