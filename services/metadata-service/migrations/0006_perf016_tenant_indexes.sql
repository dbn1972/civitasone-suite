-- 0006_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This is the metadata-service tranche-6 file: 4
-- table(s) with RLS enabled and a tenant_id column but no index whose
-- leading column is tenant_id, re-measured live on 2026-09-18 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster (65 reachable service DBs,
-- 1590 tenant_id-bearing tables fleet-wide) -- metadata: 4 missing,
-- matching scripts/ci/tenant-index-baseline.json and the PERF-016 gap
-- report row exactly (no drift found this tranche, same as tranche 5).
--
-- Tables covered by this file:
--   metadata.custom_records (status column: no)
--   metadata.field_definitions (status column: no)
--   metadata.layout_definitions (status column: no)
--   metadata.validation_rules (status column: no)
--
-- Every table gets the bare leading tenant_id index (the guard's minimum
-- bar). Tables with a `status` column additionally get the
-- (tenant_id, status) composite, per the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-5.
-- Status-column presence checked directly against this service's live
-- information_schema, connected as metadata_svc (not civitas_admin, matching
-- tranches 1-5's methodology).
--
-- Index naming: idx_<table>_tenant[_status]. Where the table's own bare
-- name already carries the metadata_ prefix, it is reused verbatim (no double
-- prefixing); where it doesn't, metadata_ is prepended -- same rule tranches
-- 3-5 used. Checked pg_indexes for every table above: no existing index
-- anywhere near these generated names (only *_pkey, unique-constraint, and
-- feature-specific idx_* names), so none of these CREATE INDEX CONCURRENTLY
-- IF NOT EXISTS statements silently skip a pre-existing, differently
-- purposed index. Checked information_schema.tables for bare-name
-- collisions across schemas in civitas_metadata: none found for any table in
-- this file.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-5's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS metadata.idx_metadata_custom_records_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS metadata.idx_metadata_field_definitions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS metadata.idx_metadata_layout_definitions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS metadata.idx_metadata_validation_rules_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metadata_custom_records_tenant
  ON metadata.custom_records (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metadata_field_definitions_tenant
  ON metadata.field_definitions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metadata_layout_definitions_tenant
  ON metadata.layout_definitions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metadata_validation_rules_tenant
  ON metadata.validation_rules (tenant_id);
