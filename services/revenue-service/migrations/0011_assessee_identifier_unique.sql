-- 0011_assessee_identifier_unique.sql
-- GAP-REVENUE-ASSESSEES-03: the assessee register had no uniqueness guard on
-- the identifier (property ID / connection no / PAN), so the same identifier
-- could be registered twice, splitting an assessee's demands across duplicate
-- records. Add a per-tenant unique index on (tenant_id, identifier_no); the
-- assesseeCreate consumer already classifies Postgres class-23 constraint
-- violations as a non-retryable error, so a duplicate insert now fails fast
-- (surfaced to the client as a 4xx) instead of silently creating a twin.
--
-- Tenant-scoped (not global) so two different ULBs may legitimately reuse the
-- same local identifier. Idempotent: IF NOT EXISTS. CONCURRENTLY so it does not
-- take a long write lock on the live table (must run outside a transaction
-- block — same pattern as 0007_perf002_tenant_indexes.sql).
--
-- A UNIQUE index build fails if duplicates already exist; verified against the
-- test cluster on 2026-10-06 that assessee.assessees has zero
-- (tenant_id, identifier_no) duplicates before applying.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS assessee.uq_assessees_tenant_identifier;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_assessees_tenant_identifier
  ON assessee.assessees (tenant_id, identifier_no);
