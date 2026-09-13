-- Migration: 0033_org_hierarchy_levels.sql
-- Purpose: COMP-014 -- platform-admin/org-config/OrgConfigPage.tsx always showed
--          5 hardcoded hierarchy levels (DEFAULT_LEVELS) with a save
--          (PUT /v1/admin/org-hierarchy) that 404s -- no PUT route ever existed
--          on that path -- and, worse, reported "saved" even on that failure:
--          persistOrder()'s `.catch(() => null)` only swallows network-level
--          fetch() rejections, never a resolved non-2xx response, so the
--          success notice was set unconditionally after the await.
--
-- This is a DIFFERENT concept from /v1/admin/org-hierarchy (gap/routes.ts),
-- which forwards to tenant-service's real `orgUnits` table -- actual org-unit
-- INSTANCES (a flat department/division/section/unit/branch taxonomy, no
-- per-tier order/description/color) consumed by the already-fixed
-- admin/org/OrgHierarchyManager.tsx. This table instead models a configurable
-- hierarchy-LEVEL TAXONOMY: how many reporting tiers exist and how each is
-- labelled/described/coloured. Deliberately a separate table AND a separate
-- route path (/v1/admin/org-hierarchy-levels -- see
-- modules/org-hierarchy-levels/routes.ts) so the two concepts never collide
-- in the API or in code.
--
-- tenant_id uses this codebase's established sentinel-zero-UUID
-- platform-default convention (statutory.statutory_config migration 0038 and
-- payroll.tax_slab_config migration 0039 in payroll-service; notification-
-- service migrations 0003/0044/0045): a real tenant_id row is that tenant's
-- own override; the row with tenant_id =
-- '00000000-0000-0000-0000-000000000000' is the platform default.
-- modules/org-hierarchy-levels/repo.ts's fetchLevelsForTenant() resolves the
-- tenant's own rows if any exist, else the platform default's rows -- a
-- NULLable tenant_id was deliberately avoided for the same reason those
-- migrations give: NULL never matches `tenant_id = current_tenant_id()`
-- under FORCE ROW LEVEL SECURITY and would be invisible to every tenant.
--
-- The seeded platform-default rows below are EXACTLY DEFAULT_LEVELS' pre-fix
-- values (OrgConfigPage.tsx, verified against the file on origin/main at the
-- time of this migration) -- no tenant's rendered levels change as a result
-- of this migration; only an explicit tenant override (inserted via
-- PUT /v1/admin/org-hierarchy-levels after this migration) changes anything.
--
-- Rollback: DROP TABLE org_hierarchy_levels.org_hierarchy_levels;
--           DROP SCHEMA org_hierarchy_levels;
-- Affected services: admin-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS org_hierarchy_levels;

-- current_tenant_id() already exists (created by earlier migrations, e.g.
-- 0006/0013/0014/0032) on the default search path -- guard so this migration
-- never needs to own it, mirroring 0029/0032's own guard.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS org_hierarchy_levels.org_hierarchy_levels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,  -- '00000000-...-000000000000' = platform default
  level_key    VARCHAR(64) NOT NULL,
  sort_order   INTEGER NOT NULL,
  label        VARCHAR(200) NOT NULL,
  description  VARCHAR(1000) NOT NULL DEFAULT '',
  examples     VARCHAR(500) NOT NULL DEFAULT '',
  color        VARCHAR(16) NOT NULL DEFAULT '#334155',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID,
  CONSTRAINT ux_org_hierarchy_levels_tenant_key UNIQUE (tenant_id, level_key)
);

CREATE INDEX IF NOT EXISTS ix_org_hierarchy_levels_tenant_order
  ON org_hierarchy_levels.org_hierarchy_levels (tenant_id, sort_order);

ALTER TABLE org_hierarchy_levels.org_hierarchy_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_hierarchy_levels.org_hierarchy_levels FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON org_hierarchy_levels.org_hierarchy_levels;
CREATE POLICY tenant_isolation_policy ON org_hierarchy_levels.org_hierarchy_levels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Additive, SELECT-only: every tenant session can also see the sentinel
-- platform-default rows (mirrors payroll-service migrations 0038/0039
-- exactly). Postgres ORs together permissive policies for the same command,
-- so INSERT/UPDATE/DELETE stay governed solely by the strict policy above --
-- a tenant can never write the sentinel row itself.
DROP POLICY IF EXISTS platform_default_read_policy ON org_hierarchy_levels.org_hierarchy_levels;
CREATE POLICY platform_default_read_policy ON org_hierarchy_levels.org_hierarchy_levels
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- Seed the platform default = the exact pre-fix DEFAULT_LEVELS values.
-- civitas_admin's migration-running role is NOSUPERUSER NOBYPASSRLS (see
-- payroll-service migration 0037's comment for the equivalent convention)
-- and this table is FORCE ROW LEVEL SECURITY, so the INSERT must satisfy its
-- own WITH CHECK -- set the GUC to the sentinel value for the duration of
-- this one transaction, exactly like migration 0038 does, rather than
-- bypassing RLS.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000';
INSERT INTO org_hierarchy_levels.org_hierarchy_levels
  (tenant_id, level_key, sort_order, label, description, examples, color, updated_by)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'ministry',   1, 'Ministry',   'Top-level governance body (central ministry)',    'Ministry of Finance, Ministry of Home Affairs', '#1e40af', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000000', 'department', 2, 'Department', 'Functional department under a ministry',          'Department of Revenue, DOPT',                   '#065f46', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000000', 'division',   3, 'Division',   'Operational division within a department',        'Direct Taxes Division',                         '#7c3aed', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000000', 'section',    4, 'Section',    'Working section within a division',               'Section-I (Policy), Accounts Section',          '#b45309', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000000', 'unit',       5, 'Unit',       'Smallest addressable unit -- maps to cost centre', 'Pay & Accounts Unit, Records Unit',            '#be185d', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id, level_key) DO NOTHING;
COMMIT;
