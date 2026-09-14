-- 0024_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): asset-service is tied with project-service
-- as the worst offender fleet-wide by missing-index count after tranche 1
-- (works-service + hrms-service). Measured live against a freshly bootstrapped
-- cluster on 2026-09-14 via `node scripts/ci/tenant-index-guard.mjs asset`: 38
-- RLS'd tenant tables in this service, 15 with no index whose leading column
-- is tenant_id, spread across the _outbox/asset/enterprise/insurance/
-- lifecycle/maintenance schemas. This migration is the asset-service half of
-- PERF-016's second tranche (asset-service + project-service, 30 of the
-- fleet's remaining 200 tables; see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
-- PERF-016 for the rest).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranche 1's
-- 0137_perf016_tenant_indexes.sql (hrms-service) -- `status` is the most
-- common tenant-scoped filter fleet-wide (see tenant-index-guard.mjs's own
-- has_tenant_status_composite check).
--
-- Index naming: idx_asset_<table>_tenant[_status], reusing the table's own
-- name verbatim when it already carries an asset_ prefix (asset_impairments,
-- asset_claims, asset_acquisitions, asset_disposals, asset_transfers,
-- asset_maintenance_plans) rather than doubling it, and prepending asset_
-- when it does not (fleet_maintenance, fleet_trips, spare_parts,
-- inter_org_transfers, pending_disposals, physical_verification_items,
-- physical_verifications, work_orders, messages_legacy) -- same convention
-- tranche 1 used for hrms-service.
--
-- _outbox.messages_legacy is a partitioned-outbox legacy partition that
-- still carries RLS + tenant_id (unlike the live _outbox.messages relay
-- table, which 0019_outbox_messages_drop_rls.sql already dropped RLS from
-- for this service) -- it has no status column, so it only gets the bare
-- index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an implicit
-- transaction unless the file itself opens one -- this file does not -- so
-- CONCURRENTLY is safe here, matching the precedent in
-- 0019_perf002_tenant_indexes.sql / 0137_perf016_tenant_indexes.sql.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_asset_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS asset.idx_asset_fleet_maintenance_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS asset.idx_asset_fleet_maintenance_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS asset.idx_asset_fleet_trips_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS enterprise.idx_asset_impairments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS enterprise.idx_asset_spare_parts_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS insurance.idx_asset_claims_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS insurance.idx_asset_claims_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_acquisitions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_disposals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_transfers_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_inter_org_transfers_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_pending_disposals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_physical_verification_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_physical_verifications_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS lifecycle.idx_asset_physical_verifications_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS maintenance.idx_asset_maintenance_plans_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS maintenance.idx_asset_maintenance_plans_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS maintenance.idx_asset_work_orders_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS maintenance.idx_asset_work_orders_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_fleet_maintenance_tenant
  ON asset.fleet_maintenance (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_fleet_maintenance_tenant_status
  ON asset.fleet_maintenance (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_fleet_trips_tenant
  ON asset.fleet_trips (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_impairments_tenant
  ON enterprise.asset_impairments (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_spare_parts_tenant
  ON enterprise.spare_parts (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_claims_tenant
  ON insurance.asset_claims (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_claims_tenant_status
  ON insurance.asset_claims (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_acquisitions_tenant
  ON lifecycle.asset_acquisitions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_disposals_tenant
  ON lifecycle.asset_disposals (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_transfers_tenant
  ON lifecycle.asset_transfers (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_inter_org_transfers_tenant
  ON lifecycle.inter_org_transfers (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_pending_disposals_tenant
  ON lifecycle.pending_disposals (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_physical_verification_items_tenant
  ON lifecycle.physical_verification_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_physical_verifications_tenant
  ON lifecycle.physical_verifications (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_physical_verifications_tenant_status
  ON lifecycle.physical_verifications (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_maintenance_plans_tenant
  ON maintenance.asset_maintenance_plans (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_maintenance_plans_tenant_status
  ON maintenance.asset_maintenance_plans (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_work_orders_tenant
  ON maintenance.asset_work_orders (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_asset_work_orders_tenant_status
  ON maintenance.asset_work_orders (tenant_id, status);
