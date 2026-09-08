-- 0019_perf002_tenant_indexes.sql
-- PERF-002: work_proposals is both a named "works 36/50" violation (42
-- columns, PK-only) AND one of the widest tenant tables fleet-wide by
-- column count — verified against the live dev cluster on 2026-09-08.
-- Gets the leading tenant_id index, the (tenant_id, status) composite, and
-- the (tenant_id, created_at) composite the gap calls for on the widest
-- tables (0/12 had one).
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block; safe
-- under this repo's migration runner (see finance-service
-- 0071_perf002_tenant_indexes.sql for the detailed rationale).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_work_proposals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_work_proposals_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_work_proposals_tenant_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_proposals_tenant
  ON works.work_proposals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_proposals_tenant_status
  ON works.work_proposals (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_proposals_tenant_created
  ON works.work_proposals (tenant_id, created_at);
