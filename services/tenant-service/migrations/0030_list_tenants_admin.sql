-- 0030_list_tenants_admin.sql
-- Platform-admin tenant directory (GET /v1/tenants, web screen /admin/tenants).
--
-- tenant.tenants is FORCE RLS (tenant_id = tenant.current_tenant_id()), so a
-- cross-tenant list cannot be a plain SELECT. Same sanctioned control-plane
-- pattern as 0016 (tenant_ancestry/_descendants): a SECURITY DEFINER function,
-- executable ONLY by tenant_svc. It drops FORCE RLS for its own transaction (see body)
-- so it also works when the owner is the non-BYPASSRLS service role (CI bootstrap).
-- The HTTP route is the authority on WHO may call it (super_admin /
-- platform_admin only) and audits every call; the function only ever returns
-- the directory columns (never settings / dsn / kms refs).
--
-- Additive + idempotent. Rollback: DROP FUNCTION IF EXISTS tenant.list_tenants_admin(text, int, int);

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION tenant.list_tenants_admin(p_q text, p_limit int, p_offset int)
  RETURNS TABLE (
    id uuid, name varchar, domain varchar, edition varchar, status varchar,
    region varchar, residency varchar, isolation_tier varchar,
    created_at timestamptz, total bigint
  )
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = tenant, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    -- FORCE RLS applies to the table OWNER too. When migrations are applied by
    -- the service role itself (scripts/ci/bootstrap-postgres.sh runs them as
    -- tenant_svc: non-superuser, non-BYPASSRLS, and the owner of tenant.tenants)
    -- the definer is subject to the tenant_isolation policy and a plain SELECT
    -- returns zero rows -- indistinguishable from "no tenants". Owner-bypass is
    -- restored by dropping FORCE for this transaction only: ALTER TABLE takes
    -- ACCESS EXCLUSIVE, so no other session can observe the NO FORCE state, and
    -- FORCE is re-asserted before returning. If the call errors, the whole
    -- transaction (including the ALTER) rolls back.
    -- Requires the definer to own tenant.tenants (true for the migrator role).
    ALTER TABLE tenant.tenants NO FORCE ROW LEVEL SECURITY;
    RETURN QUERY
      SELECT t.id, t.name, t.domain, t.edition, t.status, t.region, t.residency,
             t.isolation_tier, t.created_at,
             count(*) OVER () AS total
      FROM tenant.tenants t
      WHERE p_q IS NULL OR p_q = ''
         OR t.name   ILIKE '%' || p_q || '%'
         OR t.domain ILIKE '%' || p_q || '%'
      ORDER BY t.created_at DESC, t.id
      LIMIT greatest(least(p_limit, 500), 1)
      OFFSET greatest(p_offset, 0);
    ALTER TABLE tenant.tenants FORCE ROW LEVEL SECURITY;
  END;
  $$;

REVOKE ALL ON FUNCTION tenant.list_tenants_admin(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.list_tenants_admin(text, int, int) TO tenant_svc;
