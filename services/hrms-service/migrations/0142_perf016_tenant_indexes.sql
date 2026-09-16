-- 0142_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): fleet-wide tenant_id leading-index
-- backlog. hrms-service itself was already fully cleared by tranche 1
-- (#1192, 0137_perf016_tenant_indexes.sql, 20 tables) and carries 0
-- entries in scripts/ci/tenant-index-baseline.json. This tranche's main
-- pair is meeting-service + revenue-service (see those services' own
-- 0012/0009_perf016_tenant_indexes.sql), but a fresh fleet-wide `node
-- scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster on 2026-09-16 turned up 3
-- violations NOT in the baseline at all -- new, CI-failing debt
-- introduced since the baseline was last written. One of the three is
-- here:
--
--   hrms.employee.integration_sync_log
--
-- Given RLS (ENABLE + FORCE ROW LEVEL SECURITY) by
-- 0138_sec010_missing_rls.sql (SEC-010, an unrelated RLS-hardening pass)
-- without a tenant_id index -- exactly the defect tenant-index-guard.mjs
-- exists to catch. That makes `node scripts/ci/tenant-index-guard.mjs`
-- (run unconditionally, no baseline bypass, in .github/workflows/ci.yml's
-- "Tenant index guard" step) FAIL on every PR fleet-wide right now,
-- regardless of that PR's own diff -- confirmed by re-running the guard
-- against unmodified origin/main HEAD (54b3f25d) before writing this
-- file. The other two strays (admin.admin.reconciliation_breaks and
-- admin.admin.reconciliation_results, same SEC-010 root cause) are fixed
-- in admin-service's own 0037_perf016_tenant_indexes.sql in this PR.
--
-- employee.integration_sync_log carries a status column (checked live
-- against information_schema), so it gets both the bare leading tenant_id
-- index and the (tenant_id, status) composite, matching the precedent set
-- by 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-3. It
-- does not already carry an hrms_ prefix, so -- matching tranche 3's
-- naming convention -- it gets hrms_ prepended:
-- idx_hrms_integration_sync_log_tenant[_status].
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-3's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_integration_sync_log_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS employee.idx_hrms_integration_sync_log_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_integration_sync_log_tenant
  ON employee.integration_sync_log (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hrms_integration_sync_log_tenant_status
  ON employee.integration_sync_log (tenant_id, status);
