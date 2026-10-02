-- 0019_did_resolver_role.sql
-- Make telephony.did_mappings_for_number() able to see the mappings it exists
-- to resolve, whoever applied 0014.
--
-- 0014 made the resolver SECURITY DEFINER so the inbound-call path (no tenant
-- yet) can map a dialed number to its owning tenant across tenants. Its
-- effective owner is whoever ran 0014:
--   * applied as telephony_svc (CI's bootstrap-postgres.sh, and any
--     environment migrating as the service role): telephony_svc also owns
--     telephony.did_mappings, which is FORCE ROW LEVEL SECURITY, so the owner
--     is filtered too. With no app.tenant_id, current_tenant_id() is NULL and
--     the function returned zero rows: every inbound DID resolved to
--     DEFAULT_TENANT_ID (tests/contact-centre-routing.test.ts failed on every
--     CI run).
--   * applied by a superuser (the shared cloudsphere-ec2 dev cluster, where
--     the function is owned by civitas_admin, a superuser there): routing
--     worked. That cluster has 0 did_mappings rows, so no real calls were
--     misrouted.
-- Ownership was therefore environment-dependent. This pins it.
--
-- Fix: hand the function to a dedicated NOLOGIN BYPASSRLS role, same shape as
-- the *_scanner roles (finance 0052, payroll 0032) but narrower:
--   * NOLOGIN, no password and no members (stripped below even if the role
--     pre-exists), so nobody can connect or SET ROLE to it; the only way to
--     run as it is to call this one SECURITY DEFINER function.
--   * SELECT on just the three columns the function returns, on just this
--     table. No write privilege anywhere.
--   * The function keeps its pinned search_path and its EXECUTE grant to
--     telephony_svc (ownership changes do not touch grants).
-- The name does not end in _svc, so it stays outside the "no *_svc role holds
-- BYPASSRLS" invariant.
--
-- MUST RUN AS A SUPERUSER (creating a BYPASSRLS role, and ALTER FUNCTION ...
-- OWNER TO a role the runner is not a member of, both require it):
--   * CI / disposable DBs: scripts/ci/bootstrap-postgres.sh routes any
--     migration containing CREATE/ALTER ROLE to its superuser connection
--     automatically (needs_superuser()), as for the *_scanner_role migrations.
--   * Shared dev cluster / staging / prod: apply this file with the cluster
--     superuser (or the DBA role used for the *_scanner_role migrations), not
--     as telephony_svc; a telephony_svc run fails on CREATE ROLE.
-- Later migrations that CREATE OR REPLACE this function must also run as a
-- superuser (telephony_svc no longer owns it).
--
-- Rollback (superuser):
--   ALTER FUNCTION telephony.did_mappings_for_number(text) OWNER TO telephony_svc;
--   REVOKE ALL ON telephony.did_mappings FROM telephony_did_resolver;
--   REVOKE ALL ON SCHEMA telephony FROM telephony_did_resolver;
--   DROP ROLE telephony_did_resolver;
-- (Rolling back restores the zero-row behaviour wherever telephony_svc owned
-- the function.)
SET lock_timeout = '5s';

DO $$
DECLARE
  m record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telephony_did_resolver') THEN
    CREATE ROLE telephony_did_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  ELSE
    ALTER ROLE telephony_did_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS PASSWORD NULL;
    -- Nobody may be able to SET ROLE into it, and it must not inherit anything.
    FOR m IN
      SELECT pg_get_userbyid(member) AS member_role, pg_get_userbyid(roleid) AS granted_role
      FROM pg_auth_members
      WHERE roleid = 'telephony_did_resolver'::regrole OR member = 'telephony_did_resolver'::regrole
    LOOP
      EXECUTE format('REVOKE %I FROM %I', m.granted_role, m.member_role);
    END LOOP;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA telephony TO telephony_did_resolver;
GRANT SELECT (did_number, tenant_id, active) ON telephony.did_mappings TO telephony_did_resolver;

ALTER FUNCTION telephony.did_mappings_for_number(text) OWNER TO telephony_did_resolver;

REVOKE ALL ON FUNCTION telephony.did_mappings_for_number(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telephony_svc') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION telephony.did_mappings_for_number(text) TO telephony_svc';
  END IF;
END
$$;
