-- 0030_list_tenants_admin.sql
-- Platform-admin tenant directory (GET /v1/tenants, web screen /admin/tenants).
--
-- tenant.tenants is FORCE RLS (tenant_id = tenant.current_tenant_id()), so a
-- cross-tenant list cannot be a plain SELECT. Same sanctioned control-plane
-- pattern as admin-service 0053 (platform_bypass_read_policy): an additional
-- permissive SELECT-only policy gated by the transaction-local GUC
-- app.platform_bypass. The SECURITY DEFINER function below, executable ONLY by
-- tenant_svc, sets that GUC for its own transaction and restores the previous
-- value before returning. No ALTER TABLE (no ACCESS EXCLUSIVE lock) is taken on
-- the request path. INSERT/UPDATE/DELETE stay governed solely by the strict
-- tenant policy. The HTTP route is the authority on WHO may call it
-- (super_admin / platform_admin only) and audits every call; the function only
-- ever returns the directory columns (never settings / dsn / kms refs).
--
-- Additive + idempotent. Rollback: DROP FUNCTION IF EXISTS tenant.list_tenants_admin(text, int, int);
--   DROP POLICY IF EXISTS platform_bypass_read_policy ON tenant.tenants;

SET lock_timeout = '5s';

DROP POLICY IF EXISTS platform_bypass_read_policy ON tenant.tenants;
CREATE POLICY platform_bypass_read_policy ON tenant.tenants
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');

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
  DECLARE
    v_prev text := current_setting('app.platform_bypass', true);
  BEGIN
    PERFORM set_config('app.platform_bypass', 'true', true);
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
    PERFORM set_config('app.platform_bypass', coalesce(v_prev, ''), true);
  END;
  $$;

REVOKE ALL ON FUNCTION tenant.list_tenants_admin(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.list_tenants_admin(text, int, int) TO tenant_svc;
