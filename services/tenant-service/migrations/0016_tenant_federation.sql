-- 0016_tenant_federation.sql
-- District Governance Platform — Wave-A EPIC-3 (T3.1): tenant federation.
--
-- Records the Ministry -> State -> Division -> District -> Department tenant
-- topology so the control plane and analytics can resolve reporting chains
-- (G-07/G-55: "no parentTenantId -> cross-district/state aggregation impossible").
-- Additive + idempotent; orthogonal to the isolation-tier / tenant-router work.
--
-- `tenants` is FORCE RLS (a tenant sees only its own row), so topology reads are
-- a CONTROL-PLANE operation: the two functions below are SECURITY DEFINER and
-- MUST be owned by a role that bypasses RLS on tenant.tenants (a superuser or a
-- control-plane BYPASSRLS role) — which is the case when migrations are applied
-- by the admin/migrator role. They are the ONLY sanctioned cross-tenant-tree
-- read; normal OLTP never reads child rows (state dashboards read analytics
-- projections, never child OLTP — per the review's data-ownership rule).

SET lock_timeout = '5s';

ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES tenant.tenants(id);
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS gov_level   VARCHAR(24);   -- nation|state|division|district|department|office
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS lgd_code    VARCHAR(32);
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS cell_id     VARCHAR(64);
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS office_type VARCHAR(48);
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS dept_code   VARCHAR(48);

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenant.tenants(parent_tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_lgd    ON tenant.tenants(lgd_code);

-- Guard against cycles: a tenant cannot be its own parent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_no_self_parent') THEN
    ALTER TABLE tenant.tenants ADD CONSTRAINT tenants_no_self_parent CHECK (parent_tenant_id IS NULL OR parent_tenant_id <> id);
  END IF;
END $$;

-- ── control-plane topology resolution (SECURITY DEFINER) ─────────────────────
-- Ancestry: the chain from the given tenant UP to its root (root first).
CREATE OR REPLACE FUNCTION tenant.tenant_ancestry(p_tenant uuid)
  RETURNS TABLE (id uuid, name varchar, gov_level varchar, parent_tenant_id uuid, depth int)
  LANGUAGE sql
  SECURITY DEFINER
  AS $$
    WITH RECURSIVE up AS (
      SELECT t.id, t.name, t.gov_level, t.parent_tenant_id, 0 AS depth
      FROM tenant.tenants t WHERE t.id = p_tenant
      UNION ALL
      SELECT t.id, t.name, t.gov_level, t.parent_tenant_id, up.depth + 1
      FROM tenant.tenants t JOIN up ON t.id = up.parent_tenant_id
    )
    SELECT id, name, gov_level, parent_tenant_id, depth FROM up ORDER BY depth DESC;
  $$;

-- Descendants: every tenant BELOW the given one (for aggregation scoping).
CREATE OR REPLACE FUNCTION tenant.tenant_descendants(p_tenant uuid)
  RETURNS TABLE (id uuid, name varchar, gov_level varchar, parent_tenant_id uuid, depth int)
  LANGUAGE sql
  SECURITY DEFINER
  AS $$
    WITH RECURSIVE down AS (
      SELECT t.id, t.name, t.gov_level, t.parent_tenant_id, 0 AS depth
      FROM tenant.tenants t WHERE t.parent_tenant_id = p_tenant
      UNION ALL
      SELECT t.id, t.name, t.gov_level, t.parent_tenant_id, down.depth + 1
      FROM tenant.tenants t JOIN down ON t.parent_tenant_id = down.id
    )
    SELECT id, name, gov_level, parent_tenant_id, depth FROM down ORDER BY depth, name;
  $$;

REVOKE ALL ON FUNCTION tenant.tenant_ancestry(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION tenant.tenant_descendants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.tenant_ancestry(uuid)    TO tenant_svc;
GRANT EXECUTE ON FUNCTION tenant.tenant_descendants(uuid) TO tenant_svc;
