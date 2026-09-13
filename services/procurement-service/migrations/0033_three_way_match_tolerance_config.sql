-- 0033_three_way_match_tolerance_config.sql
-- DOM-011 (1/2): per-tenant configurable three-way-match tolerance, with
-- separate quantity / price / total axes instead of one blended total-only
-- check.
--
-- BEFORE this migration, src/modules/three-way-match/consumer.ts hardcoded a
-- single 5% "total" tolerance across the max of |PO-GRN| and |PO-Invoice|
-- variance — no way to change it without a deploy, and no independent check
-- on quantity or price at all (a large quantity shortfall hiding behind a
-- price increase, or vice versa, could still net out under 5% and auto-pass).
--
-- Architecture mirrors payroll-service's DOM-008 statutory_config exactly
-- (migration 0038_statutory_config.sql): a `tenant_id` sentinel-zero-UUID
-- platform-default row, a strict per-tenant tenant_isolation_policy, and an
-- ADDITIVE SELECT-only platform_default_read_policy so every tenant's own
-- session can also see just the sentinel row for fallback. Postgres ORs
-- together permissive policies for the same command, so a tenant's own
-- override rows stay governed solely by the strict policy for
-- INSERT/UPDATE/DELETE -- only SELECT gains the platform-wide row visibility.
--
-- Deliberately DIFFERENT from DOM-008 in one respect: no `effective_from`
-- effective-dating. Statutory PF/ESI/80C/80D rates are legally effective-dated
-- (they change by government notification on a known date); a three-way-match
-- tolerance is a live tenant business policy with no such legal calendar, so
-- one row per tenant (UNIQUE(tenant_id), upsert-in-place) is simpler and
-- sufficient. A future gap can add effective-dating the same way DOM-008 did
-- if a real need for it shows up.
--
-- Values are expressed as NUMERIC(5,2) percent (e.g. 2.00 = 2%), matching the
-- units already used by the adjacent variance_pct column on
-- procurement.three_way_match in THIS SAME module (rather than payroll's
-- basis-points convention, which exists there because payroll already has
-- several legally-defined rate units to keep distinct) -- mirrors the
-- ARCHITECTURE of DOM-008, expressed in the units already local to this file.
--
-- Seeded platform-default values are the gap's OWN specified defaults (2%
-- price / 0% qty), plus 5% for the total axis -- the exact value that was
-- hardcoded before this migration. Unlike DOM-008 (which seeded values
-- byte-identical to pre-fix behaviour so no existing tenant's output changed),
-- the 0% qty default here is a DELIBERATE, gap-specified platform-wide
-- tightening: the bug being fixed is precisely that the old blended 5%
-- total-only check let a pure quantity shortfall/overage pass silently as
-- long as it stayed under budget in money terms. Any tenant that needs the
-- old looser behaviour for quantity can set an explicit override row.
--
-- Rollback: DROP TABLE procurement.three_way_match_config;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS procurement.three_way_match_config (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,      -- '00000000-...-000000000000' = platform default
  qty_tolerance_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,   -- accepted vs ordered qty, %
  price_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 2,   -- invoice vs GRN-at-PO-price, %
  total_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 5,   -- blended PO-vs-GRN/Invoice, %
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           UUID NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID NOT NULL,
  CONSTRAINT ux_three_way_match_config_tenant UNIQUE (tenant_id)
);

ALTER TABLE procurement.three_way_match_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.three_way_match_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON procurement.three_way_match_config;
CREATE POLICY tenant_isolation_policy ON procurement.three_way_match_config
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- Additive, SELECT-only: every tenant session can also see the sentinel
-- platform-default row (mirrors payroll migration 0038 / notification
-- migration 0045 exactly). INSERT/UPDATE/DELETE remain governed solely by
-- the strict tenant_isolation_policy above.
DROP POLICY IF EXISTS platform_default_read_policy ON procurement.three_way_match_config;
CREATE POLICY platform_default_read_policy ON procurement.three_way_match_config
  FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- Seed the platform default. civitas_admin (the migration-running role) is
-- NOSUPERUSER NOBYPASSRLS and this table is FORCE ROW LEVEL SECURITY, so a
-- plain INSERT with no app.tenant_id GUC set fails WITH CHECK for every
-- tenant_id, sentinel included -- set the GUC to the sentinel value for the
-- duration of this one transaction so the row satisfies its own policy
-- naturally, exactly like migration 0038 does. ON CONFLICT keeps this
-- idempotent on any re-run.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000';
INSERT INTO procurement.three_way_match_config
  (tenant_id, qty_tolerance_pct, price_tolerance_pct, total_tolerance_pct, created_by, updated_by)
VALUES
  ('00000000-0000-0000-0000-000000000000', 0, 2, 5,
   '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099')
ON CONFLICT (tenant_id) DO NOTHING;
COMMIT;

-- ---------------------------------------------------------------------------
-- procurement.three_way_match: persist the per-axis applied thresholds and
-- computed variances, so a historical match row is self-explanatory even
-- after a tenant later changes its config.
--
-- `tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00` has existed on this table
-- since 0006_world_class.sql but has been a dead column since at least
-- migration 0031 (never declared in src/modules/three-way-match/schema.ts,
-- never read or written by any code -- confirmed by repo-wide grep). This
-- migration does not touch that column's definition; the accompanying code
-- change finally wires it up as "the total-tolerance threshold that was
-- actually applied to this match" (paired with the existing variance_pct as
-- "the actual computed total variance"), and adds qty_/price_ variants below
-- for the two new independent axes DOM-011 introduces. Nullable, matching
-- variance_pct's own precedent in 0031 -- historical rows keep NULL for
-- columns that did not exist when they were written.
-- ---------------------------------------------------------------------------
ALTER TABLE procurement.three_way_match
  ADD COLUMN IF NOT EXISTS qty_variance_pct    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS price_variance_pct  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS qty_tolerance_pct   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS price_tolerance_pct NUMERIC(5,2);
