-- 0016_court_scanner_role.sql
-- Cross-tenant maintenance scanner role for court-service scheduled workers.
--
-- WHY: court.* tables are FORCE ROW LEVEL SECURITY and the service connects as
-- the least-privilege role court_svc (NOBYPASSRLS — infra/db/bootstrap/
-- bootstrap_court_meeting_visitor.sql). Once 0015_outbox_inbox_rls.sql applies
-- FORCE ROW LEVEL SECURITY to _outbox.messages, the outbox relay + scheduled
-- purge (worker.ts) — which must scan unpublished/old rows ACROSS ALL TENANTS —
-- would otherwise see ZERO rows under court_svc, because no app.tenant_id GUC
-- is set for that cross-tenant scan. This dedicated BYPASSRLS role lets those
-- two maintenance loops see every tenant's outbox rows.
--
-- Mirrors visitor-service 0009_scanner_role.sql / report-service
-- 0014_report_scanner_role.sql (same password-GUC convention).
--
-- SECURITY: this role is READ-ONLY in practice — the relay reads unpublished
-- outbox rows and stamps published_at; the purge deletes published rows older
-- than 7 days. It never touches the tenant-scoped `court.*` business tables.
-- All business WRITES still go through court_svc inside the normal request/
-- consumer path, so RLS re-checks every tenant mutation.
--
-- SECURITY (SEC-P1-09): no password literal ships in this migration. Set
-- `civitas.court_scanner_password` from your secrets manager BEFORE running
-- migrations in prod, e.g.
--   PGOPTIONS="-c civitas.court_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is generated
-- so no known credential exists for this BYPASSRLS role in that environment.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.court_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'court_scanner') THEN
    EXECUTE format(
      'CREATE ROLE court_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.court_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE court_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE court_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Relay reads unpublished rows + stamps published_at; purge deletes rows past
-- retention on BOTH tables (@civitasone/outbox purgeOutbox) — grant the full
-- set startRelay/startOutboxPurge actually issue as this role.
GRANT USAGE ON SCHEMA _outbox, _inbox TO court_scanner;
GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO court_scanner;
GRANT SELECT, DELETE ON _inbox.processed TO court_scanner;

-- L1 isolation (DB-per-service) may revoke PUBLIC CONNECT on this database;
-- the scanner must be able to connect to THIS service database.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO court_scanner', current_database());
END
$$;
