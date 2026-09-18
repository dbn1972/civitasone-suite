-- 0043_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This is the payroll-service tranche-6 file: 6
-- table(s) with RLS enabled and a tenant_id column but no index whose
-- leading column is tenant_id, re-measured live on 2026-09-18 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster (65 reachable service DBs,
-- 1590 tenant_id-bearing tables fleet-wide) -- payroll: 6 missing,
-- matching scripts/ci/tenant-index-baseline.json and the PERF-016 gap
-- report row exactly (no drift found this tranche, same as tranche 5).
--
-- Tables covered by this file:
--   _outbox.messages_legacy (status column: no)
--   payroll.off_cycle_runs (status column: yes)
--   payroll.payroll_register (status column: no)
--   payroll.payroll_salary_revisions (status column: no)
--   payroll.payroll_structures (status column: yes)
--   statutory.payroll_gratuity (status column: yes)
--
-- Every table gets the bare leading tenant_id index (the guard's minimum
-- bar). Tables with a `status` column additionally get the
-- (tenant_id, status) composite, per the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-5.
-- Status-column presence checked directly against this service's live
-- information_schema, connected as payroll_svc (not civitas_admin, matching
-- tranches 1-5's methodology).
--
-- Index naming: idx_<table>_tenant[_status]. Where the table's own bare
-- name already carries the payroll_ prefix, it is reused verbatim (no double
-- prefixing); where it doesn't, payroll_ is prepended -- same rule tranches
-- 3-5 used. Checked pg_indexes for every table above: no existing index
-- anywhere near these generated names (only *_pkey, unique-constraint, and
-- feature-specific idx_* names), so none of these CREATE INDEX CONCURRENTLY
-- IF NOT EXISTS statements silently skip a pre-existing, differently
-- purposed index. Checked information_schema.tables for bare-name
-- collisions across schemas in civitas_payroll: none found for any table in
-- this file.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-5's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_payroll_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_off_cycle_runs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_off_cycle_runs_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_register_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_salary_revisions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_structures_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payroll.idx_payroll_structures_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS statutory.idx_payroll_gratuity_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS statutory.idx_payroll_gratuity_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_off_cycle_runs_tenant
  ON payroll.off_cycle_runs (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_off_cycle_runs_tenant_status
  ON payroll.off_cycle_runs (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_register_tenant
  ON payroll.payroll_register (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_salary_revisions_tenant
  ON payroll.payroll_salary_revisions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_structures_tenant
  ON payroll.payroll_structures (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_structures_tenant_status
  ON payroll.payroll_structures (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gratuity_tenant
  ON statutory.payroll_gratuity (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_gratuity_tenant_status
  ON statutory.payroll_gratuity (tenant_id, status);
