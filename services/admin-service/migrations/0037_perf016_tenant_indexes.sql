-- 0037_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): fleet-wide tenant_id leading-index
-- backlog. This tranche's main pair is meeting-service + revenue-service
-- (see those services' own 0012/0009_perf016_tenant_indexes.sql), but a
-- fresh fleet-wide `node scripts/ci/tenant-index-guard.mjs --report`
-- against a freshly bootstrapped postgis/postgis:16-3.4 cluster on
-- 2026-09-16 turned up 3 violations NOT in scripts/ci/tenant-index-
-- baseline.json at all -- i.e. new, CI-failing debt introduced since the
-- baseline was last written, not part of the original PERF-002/PERF-016
-- count. Two of the three are in this service:
--
--   admin.admin.reconciliation_breaks
--   admin.admin.reconciliation_results
--
-- Both were given RLS (ENABLE + FORCE ROW LEVEL SECURITY) by
-- 0032_sec010_reconciliation_rls.sql (SEC-010, an unrelated RLS-hardening
-- pass) without a tenant_id index, which is exactly the defect
-- tenant-index-guard.mjs exists to catch: it makes `node
-- scripts/ci/tenant-index-guard.mjs` (run unconditionally, no baseline
-- bypass, in .github/workflows/ci.yml's "Tenant index guard" step) FAIL
-- on every PR fleet-wide right now, regardless of that PR's own diff --
-- confirmed by re-running the guard against unmodified origin/main HEAD
-- (54b3f25d) before writing this file. Rather than leave that live CI
-- breakage in place, this migration fixes both, plus (since this service
-- is already being touched) the 5 pre-existing baselined admin-service
-- violations, clearing admin-service entirely: 7 tables total, 0 missing
-- afterward. See scripts/ci/tenant-index-baseline.json in this same PR for
-- the corresponding removal.
--
-- The third stray violation, hrms.employee.integration_sync_log, is fixed
-- in hrms-service's own 0142_perf016_tenant_indexes.sql in this PR
-- (introduced the same way, by 0138_sec010_missing_rls.sql).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-3 --
-- checked directly against this service's live information_schema, not
-- inferred from migration text: health.admin_health_snapshots,
-- support.admin_support_tickets, tenants.admin_tenants and
-- webhooks.webhook_deliveries carry a status column; _outbox.messages_legacy,
-- admin.reconciliation_breaks and admin.reconciliation_results do not.
--
-- Index naming: idx_admin_<table>_tenant[_status], reusing the table's
-- own name verbatim when it already carries an admin_ prefix (matching
-- tranche 3's convention) rather than doubling it -- admin_health_snapshots,
-- admin_support_tickets and admin_tenants already carry the prefix, so
-- they become idx_admin_health_snapshots_tenant,
-- idx_admin_support_tickets_tenant and idx_admin_tenants_tenant, not
-- idx_admin_admin_health_snapshots_tenant etc. messages_legacy,
-- reconciliation_breaks, reconciliation_results and webhook_deliveries do
-- not carry the prefix, so they get admin_ prepended.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-3's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_admin_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS admin.idx_admin_reconciliation_breaks_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS admin.idx_admin_reconciliation_results_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS health.idx_admin_health_snapshots_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS health.idx_admin_health_snapshots_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS support.idx_admin_support_tickets_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS support.idx_admin_support_tickets_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS tenants.idx_admin_tenants_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS tenants.idx_admin_tenants_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS webhooks.idx_admin_webhook_deliveries_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS webhooks.idx_admin_webhook_deliveries_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_reconciliation_breaks_tenant
  ON admin.reconciliation_breaks (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_reconciliation_results_tenant
  ON admin.reconciliation_results (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_health_snapshots_tenant
  ON health.admin_health_snapshots (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_health_snapshots_tenant_status
  ON health.admin_health_snapshots (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_support_tickets_tenant
  ON support.admin_support_tickets (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_support_tickets_tenant_status
  ON support.admin_support_tickets (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_tenants_tenant
  ON tenants.admin_tenants (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_tenants_tenant_status
  ON tenants.admin_tenants (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_webhook_deliveries_tenant
  ON webhooks.webhook_deliveries (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_webhook_deliveries_tenant_status
  ON webhooks.webhook_deliveries (tenant_id, status);
