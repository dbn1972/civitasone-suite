-- 0091_perf002_tenant_created_index.sql
-- PERF-002: crm.contacts is one of the fleet's widest tenant tables (49
-- columns) and had no (tenant_id, created_at) composite — verified against
-- the live dev cluster on 2026-09-08. It already has a leading tenant_id
-- index, so this is additive-only.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block; safe
-- under this repo's migration runner (see finance-service
-- 0071_perf002_tenant_indexes.sql for the detailed rationale).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS crm.idx_contacts_tenant_created;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_created
  ON crm.contacts (tenant_id, created_at);
