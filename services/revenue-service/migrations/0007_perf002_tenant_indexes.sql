-- 0007_perf002_tenant_indexes.sql
-- PERF-002: RLS'd tenant tables with no index whose leading column is
-- tenant_id force a sequential scan under RLS on every tenant-scoped query.
-- First tranche: the six revenue tables named in the gap's evidence, all
-- PK-only — verified against the live dev cluster on 2026-09-08. Composite
-- (tenant_id, status) is added only where a status column exists
-- (assessments, remissions); assessees/dcb_entries/rate_heads/rate_slabs
-- have no status column.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block; safe
-- under this repo's migration runner (see finance-service
-- 0071_perf002_tenant_indexes.sql for the detailed rationale, and
-- 0063_drop_redundant_indexes.sql in finance-service for the precedent).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS assessee.idx_assessees_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_assessments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_assessments_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_dcb_entries_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_remissions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_remissions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS rates.idx_rate_heads_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS rates.idx_rate_slabs_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assessees_tenant
  ON assessee.assessees (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assessments_tenant
  ON assessment.assessments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assessments_tenant_status
  ON assessment.assessments (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcb_entries_tenant
  ON assessment.dcb_entries (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_remissions_tenant
  ON assessment.remissions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_remissions_tenant_status
  ON assessment.remissions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_heads_tenant
  ON rates.rate_heads (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_slabs_tenant
  ON rates.rate_slabs (tenant_id);
