-- 0040_payroll_audit_scanner_role.sql
-- Dedicated read-only, cross-tenant BYPASSRLS role for the DOM-018 payroll
-- audit tooling (services/payroll-service/scripts/audit/dom-018-pctofbasic-check.mjs,
-- PR #1165).
--
-- WHY A NEW ROLE INSTEAD OF payroll_scanner: an independent review of PR
-- #1165 found that its documented instructions ("connect as payroll_scanner")
-- do not work -- payroll_scanner (migration 0032_payroll_scanner_role.sql)
-- is BYPASSRLS but is deliberately, explicitly scoped to `_outbox`/`_inbox`
-- ONLY, for the outbox relay + scheduled purge maintenance loops (see
-- services/payroll-service/src/shared/scanner-db.ts's own doc comment: "NEVER
-- use this handle for the tenant-scoped payroll.*/loans.*/statutory.*
-- business tables"). That boundary is deliberate and is pinned by
-- tests/outbox-inbox-rls.static.test.ts. Widening payroll_scanner's grants to
-- also cover schema `payroll` would silently erode a security invariant that
-- was never intended to include read access to payroll business data, purely
-- to make an unrelated audit script's instructions match reality. So: a
-- second, narrower BYPASSRLS role instead, whose only purpose is read-only
-- cross-tenant SELECT on schema `payroll` for ad-hoc/CI audit scripts like
-- this one. It has no write privileges anywhere and no access to `loans`,
-- `statutory`, `_outbox`, or `_inbox`.
--
-- Mirrors the password-GUC convention of 0032_payroll_scanner_role.sql /
-- works-service 0012_works_scanner_role.sql / court-service
-- 0016_court_scanner_role.sql / visitor-service 0009_scanner_role.sql.
--
-- SECURITY (SEC-P1-09 convention): no password literal ships in this
-- migration. Set `civitas.payroll_audit_scanner_password` from your secrets
-- manager BEFORE running migrations in prod, e.g.
--   PGOPTIONS="-c civitas.payroll_audit_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev), a RANDOM one-time password is generated
-- so no known credential exists for this BYPASSRLS role in that environment.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.payroll_audit_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payroll_audit_scanner') THEN
    EXECUTE format(
      'CREATE ROLE payroll_audit_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.payroll_audit_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE payroll_audit_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE payroll_audit_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Read-only: SELECT on schema payroll's current tables plus any future ones
-- (ALTER DEFAULT PRIVILEGES), and nothing else. No INSERT/UPDATE/DELETE, no
-- access to loans/statutory/_outbox/_inbox.
GRANT USAGE ON SCHEMA payroll TO payroll_audit_scanner;
GRANT SELECT ON ALL TABLES IN SCHEMA payroll TO payroll_audit_scanner;
ALTER DEFAULT PRIVILEGES IN SCHEMA payroll GRANT SELECT ON TABLES TO payroll_audit_scanner;

-- L1 isolation (DB-per-service) may revoke PUBLIC CONNECT on this database;
-- the scanner must be able to connect to THIS service database.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO payroll_audit_scanner', current_database());
END
$$;
