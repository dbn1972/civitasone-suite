-- 0020_identity_scanner_role.sql — dedicated BYPASSRLS scanner role for
-- cross-tenant maintenance scans (mirrors helpdesk-service migration
-- 0016_scanner_role.sql / visitor-service migration 0009_scanner_role.sql).
--
-- WHY: identity_svc is NOBYPASSRLS. Two worker.ts housekeeping sweeps
-- deliberately scan ALL tenants in one pass:
--   - sessions/repo.ts#reapExpiredSessions (flips active-but-past-expiry
--     sessions to "expired")
--   - breakglass/repo.ts#sweepExpiredGrants (flips active-but-past-expiry
--     emergency-access grants to "expired")
-- Both sessions.sessions and breakglass.grants carry FORCE ROW LEVEL SECURITY
-- (migrations 0012/0013), and both sweeps run from worker.ts's setInterval
-- with NO app.tenant_id GUC set (unlike per-message queue consumers, which
-- worker.ts explicitly wraps in runWithTenant(msg.tenantId, ...) — see the
-- queue.subscribe wrapper near the top of worker.ts). Under FORCE RLS with no
-- GUC set, `tenant_id = current_tenant_id()` compares against NULL and
-- matches nothing — so both sweeps have silently reaped/expired ZERO rows,
-- for every tenant, since the day #146 flipped identity_svc to NOBYPASSRLS.
-- The one existing DB test for the break-glass sweep
-- (tests/apikeys-breakglass.db.test.ts) masked this by wrapping the call in
-- runWithTenant(TENANT_A, ...), which only happens to work because the test
-- itself supplies the tenant context production never provides.
--
-- This role is used for a READ-ONLY cross-tenant scan to discover which
-- (tenantId, id) pairs are due — the actual write for each tenant still runs
-- on the primary identity_svc connection inside runWithTenant(tenantId, ...),
-- so RLS still governs every mutation. identity_scanner cannot write, and
-- cannot read anything outside these two tables.
--
-- SECURITY: no password literal ships in this migration. The password is
-- taken from the `civitas.identity_scanner_password` GUC — set it from your
-- secrets manager BEFORE running migrations, e.g.
--   PGOPTIONS="-c civitas.identity_scanner_password=$(vault kv get -field=pw ...)" \
--     <run migrations>
-- When the GUC is absent (local/dev/CI), a RANDOM one-time password is
-- generated so no known credential exists for this BYPASSRLS role; CI's own
-- bootstrap script (scripts/ci/bootstrap-postgres.sh) recognizes the
-- `CREATE ROLE ..._scanner` pattern and sets this GUC to the repo-wide
-- `<role>_dev_pw` convention automatically.

DO $$
DECLARE
  scanner_pw text := coalesce(
    nullif(current_setting('civitas.identity_scanner_password', true), ''),
    -- No pgcrypto dependency: 64 hex chars of non-deterministic entropy.
    md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)
  );
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_scanner') THEN
    EXECUTE format(
      'CREATE ROLE identity_scanner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
      scanner_pw);
  ELSE
    -- Only rotate the password when one was explicitly provided via the GUC;
    -- otherwise leave the existing password untouched (idempotent re-runs).
    IF nullif(current_setting('civitas.identity_scanner_password', true), '') IS NOT NULL THEN
      EXECUTE format('ALTER ROLE identity_scanner PASSWORD %L', scanner_pw);
    END IF;
    ALTER ROLE identity_scanner BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- civitas_identity revokes CONNECT from PUBLIC (bootstrap.generated.sql) and
-- grants it only to identity_svc — without this, identity_scanner
-- authenticates but every connection attempt fails with "permission denied
-- for database" before it ever reaches a query. Verified empirically against
-- this cluster.
GRANT CONNECT ON DATABASE civitas_identity TO identity_scanner;

GRANT USAGE ON SCHEMA sessions TO identity_scanner;
GRANT SELECT ON sessions.sessions TO identity_scanner;

GRANT USAGE ON SCHEMA breakglass TO identity_scanner;
GRANT SELECT ON breakglass.grants TO identity_scanner;
