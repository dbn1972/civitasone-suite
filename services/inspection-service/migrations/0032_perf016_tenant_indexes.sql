-- 0032_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This is the inspection-service tranche-6 file: 3
-- table(s) with RLS enabled and a tenant_id column but no index whose
-- leading column is tenant_id, re-measured live on 2026-09-18 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster (65 reachable service DBs,
-- 1590 tenant_id-bearing tables fleet-wide) -- inspection: 3 missing,
-- matching scripts/ci/tenant-index-baseline.json and the PERF-016 gap
-- report row exactly (no drift found this tranche, same as tranche 5).
--
-- Tables covered by this file:
--   findings.compliance_notices (status column: no)
--   licence.licence_conditions (status column: no)
--   survey.sampling_frames (status column: no)
--
-- Every table gets the bare leading tenant_id index (the guard's minimum
-- bar). Tables with a `status` column additionally get the
-- (tenant_id, status) composite, per the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-5.
-- Status-column presence checked directly against this service's live
-- information_schema, connected as inspection_svc (not civitas_admin, matching
-- tranches 1-5's methodology).
--
-- Index naming: idx_<table>_tenant[_status]. Where the table's own bare
-- name already carries the inspection_ prefix, it is reused verbatim (no double
-- prefixing); where it doesn't, inspection_ is prepended -- same rule tranches
-- 3-5 used. Checked pg_indexes for every table above: no existing index
-- anywhere near these generated names (only *_pkey, unique-constraint, and
-- feature-specific idx_* names), so none of these CREATE INDEX CONCURRENTLY
-- IF NOT EXISTS statements silently skip a pre-existing, differently
-- purposed index. Checked information_schema.tables for bare-name
-- collisions across schemas in civitas_inspection: none found for any table in
-- this file.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-5's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS findings.idx_inspection_compliance_notices_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS licence.idx_inspection_licence_conditions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS survey.idx_inspection_sampling_frames_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_compliance_notices_tenant
  ON findings.compliance_notices (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_licence_conditions_tenant
  ON licence.licence_conditions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inspection_sampling_frames_tenant
  ON survey.sampling_frames (tenant_id);
