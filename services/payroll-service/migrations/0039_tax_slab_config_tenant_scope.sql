-- DOM-008 (completing #1117): tenant-scope payroll.tax_slab_config.
--
-- PR #1117 made PF/EPS/ESI/std-deduction/80C/80D caps tenant-overridable via
-- statutory.statutory_config (migration 0038), but deliberately left this
-- gap's own original evidence unaddressed: tax_slab_config (the FY-versioned
-- income-tax slabs / surcharge bands / 87A rebate / std deduction consumed by
-- tax/engine.ts) had no tenant_id column at all — a single global row per
-- (fy_start_year, regime), so a tenant-specific slab or 80C/80D-adjacent
-- change was structurally impossible without a code deploy, regardless of
-- what domain.ts's statutory config resolution could already do.
--
-- tenant_id uses the same sentinel-zero-UUID platform-default convention as
-- migration 0038 (real tenant_id for an override row,
-- '00000000-0000-0000-0000-000000000000' for the platform default) rather
-- than a nullable column, for the identical reason: NULL would never match
-- `tenant_id = payroll.current_tenant_id()` under FORCE ROW LEVEL SECURITY
-- and would be invisible to every tenant.
--
-- No separate effective_from column: (fy_start_year, regime) already gives
-- FY-level effective-dating for income-tax slabs (Union Budget changes them
-- once per FY, never mid-year) — engine.ts's getTaxConfig() resolves a
-- tenant's own (regime, FY) row if present, else the platform default's row
-- for that same (regime, FY), else UnconfiguredFyError. Composite uniqueness
-- moves from (fy_start_year, regime) to (tenant_id, fy_start_year, regime).
--
-- Three RLS policies, mirroring 0037 + 0038 exactly:
--  - tenant_isolation_policy: strict per-tenant match, governs writes.
--  - platform_default_read_policy: additive SELECT-only visibility of the
--    sentinel rows for every tenant session (future per-request reads).
--  - platform_bypass_read_policy: additive SELECT-only, gated by the
--    `app.platform_bypass` GUC, ONLY ever set by trusted server-side code
--    with no user input (config.ts's loadTaxConfig(), which must read every
--    tenant's + the platform's rows in one boot-time bulk load to populate
--    the in-memory registry — mirrors audit-service's scopedPlatformRead /
--    migration 0021 and payroll-service's own migration 0037 exactly).
--
-- Backfill: every existing row (the 6 rows seeded by migration 0012: FY
-- 2024-25/2025-26/2026-27 x old/new) becomes a platform-default row via the
-- column DEFAULT — byte-identical to current behaviour; no existing tenant's
-- computed tax changes as a result of this migration, only an explicit
-- tenant override (inserted after this migration) does.
--
-- Rollback:
--   DROP POLICY platform_bypass_read_policy ON payroll.tax_slab_config;
--   DROP POLICY platform_default_read_policy ON payroll.tax_slab_config;
--   DROP POLICY tenant_isolation_policy ON payroll.tax_slab_config;
--   ALTER TABLE payroll.tax_slab_config DISABLE ROW LEVEL SECURITY;
--   DROP INDEX IF EXISTS payroll.ux_tax_slab_config_tenant_fy_regime;
--   CREATE UNIQUE INDEX ux_tax_slab_config_fy_regime ON payroll.tax_slab_config (fy_start_year, regime);
--   ALTER TABLE payroll.tax_slab_config DROP COLUMN tenant_id;

SET lock_timeout = '5s';

ALTER TABLE payroll.tax_slab_config
  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS created_by UUID;

DROP INDEX IF EXISTS payroll.ux_tax_slab_config_fy_regime;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_slab_config_tenant_fy_regime
  ON payroll.tax_slab_config (tenant_id, fy_start_year, regime);
CREATE INDEX IF NOT EXISTS ix_tax_slab_config_tenant
  ON payroll.tax_slab_config (tenant_id);

ALTER TABLE payroll.tax_slab_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.tax_slab_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.tax_slab_config;
CREATE POLICY tenant_isolation_policy ON payroll.tax_slab_config
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- Additive, SELECT-only: every tenant session can also see the sentinel
-- platform-default rows (mirrors migration 0038 exactly).
DROP POLICY IF EXISTS platform_default_read_policy ON payroll.tax_slab_config;
CREATE POLICY platform_default_read_policy ON payroll.tax_slab_config
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- Additive, SELECT-only, GUC-gated: lets loadTaxConfig()'s trusted boot-time
-- bulk load see every tenant's rows in one query to populate the in-memory
-- registry (mirrors migration 0037 exactly). Never set from user input.
DROP POLICY IF EXISTS platform_bypass_read_policy ON payroll.tax_slab_config;
CREATE POLICY platform_bypass_read_policy ON payroll.tax_slab_config
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
