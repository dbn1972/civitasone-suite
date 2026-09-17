-- 0020_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This is the contract-service tranche-6 file: 6
-- table(s) with RLS enabled and a tenant_id column but no index whose
-- leading column is tenant_id, re-measured live on 2026-09-18 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster (65 reachable service DBs,
-- 1590 tenant_id-bearing tables fleet-wide) -- contract: 6 missing,
-- matching scripts/ci/tenant-index-baseline.json and the PERF-016 gap
-- report row exactly (no drift found this tranche, same as tranche 5).
--
-- Tables covered by this file:
--   _outbox.messages_legacy (status column: no)
--   contracts.contract_amendments (status column: no)
--   contracts.contract_milestones (status column: yes)
--   rate.contract_rate_items (status column: no)
--   versions.contract_versions (status column: no)
--   versions.redlines (status column: no)
--
-- Every table gets the bare leading tenant_id index (the guard's minimum
-- bar). Tables with a `status` column additionally get the
-- (tenant_id, status) composite, per the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-5.
-- Status-column presence checked directly against this service's live
-- information_schema, connected as contract_svc (not civitas_admin, matching
-- tranches 1-5's methodology).
--
-- Index naming: idx_<table>_tenant[_status]. Where the table's own bare
-- name already carries the contract_ prefix, it is reused verbatim (no double
-- prefixing); where it doesn't, contract_ is prepended -- same rule tranches
-- 3-5 used. Checked pg_indexes for every table above: no existing index
-- anywhere near these generated names (only *_pkey, unique-constraint, and
-- feature-specific idx_* names), so none of these CREATE INDEX CONCURRENTLY
-- IF NOT EXISTS statements silently skip a pre-existing, differently
-- purposed index. Checked information_schema.tables for bare-name
-- collisions across schemas in civitas_contract: none found for any table in
-- this file.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-5's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_contract_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_contract_amendments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_contract_milestones_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_contract_milestones_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS rate.idx_contract_rate_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS versions.idx_contract_versions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS versions.idx_contract_redlines_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_amendments_tenant
  ON contracts.contract_amendments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_milestones_tenant
  ON contracts.contract_milestones (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_milestones_tenant_status
  ON contracts.contract_milestones (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_rate_items_tenant
  ON rate.contract_rate_items (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_versions_tenant
  ON versions.contract_versions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_redlines_tenant
  ON versions.redlines (tenant_id);
