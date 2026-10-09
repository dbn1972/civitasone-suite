-- 0052: Leading tenant_id index on quarters.estab_licence_fee_rates_superseded.
--
-- The archive table created by 0049_licence_fee_no_overlap.sql is RLS-enabled
-- (policy keyed on tenant_id) but shipped without any index whose leading
-- column is tenant_id, which fails the CI tenant-index guard
-- (scripts/ci/tenant-index-guard.mjs). quarter_type is the second column
-- because the table mirrors estab_licence_fee_rates and recovery lookups are
-- by (tenant, quarter type).
--
-- Plain (non-CONCURRENTLY) CREATE INDEX: the table is a tiny audit archive
-- and recent estab migrations (0050, 0051) use the same form. Additive and
-- idempotent.
--
-- Rollback:
--   DROP INDEX IF EXISTS quarters.idx_estab_licence_fee_rates_superseded_tenant_type;

CREATE INDEX IF NOT EXISTS idx_estab_licence_fee_rates_superseded_tenant_type
  ON quarters.estab_licence_fee_rates_superseded (tenant_id, quarter_type);
