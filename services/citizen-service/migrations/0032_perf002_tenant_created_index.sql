-- 0032_perf002_tenant_created_index.sql
-- PERF-002: catalogue.service_definitions is one of the fleet's widest
-- tenant tables (43 columns) and had no (tenant_id, created_at) composite —
-- verified against the live dev cluster on 2026-09-08. It already has a
-- leading tenant_id index, so this is additive-only.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block; safe
-- under this repo's migration runner (see finance-service
-- 0071_perf002_tenant_indexes.sql for the detailed rationale).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS catalogue.idx_service_definitions_tenant_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_service_definitions_tenant_created
  ON catalogue.service_definitions (tenant_id, created_at);
