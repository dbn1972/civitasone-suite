-- 0026_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This tranche (5) covers procurement-service (11,
-- worst offender) + grant-service (10) as its main pair (see those
-- services' own 0038/0015_perf016_tenant_indexes.sql), plus the next two
-- worst offenders in the same pass -- legal-service and
-- notification-service -- re-measured live on 2026-09-16 via `node
-- scripts/ci/tenant-index-guard.mjs --report` against a freshly bootstrapped
-- postgis/postgis:16-3.4 cluster: legal 29 RLS tables / 9 missing,
-- notification 47 RLS tables / 8 missing -- both match the gap report
-- row's own figures exactly, no staleness found this time.
--
-- This file is the legal-service half: 9 tables across the
-- _outbox/cases/contracts/documents/hearings/notices/reminders/settlements
-- schemas, with no index whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-4 --
-- checked directly against this service's live information_schema (as
-- legal_svc, not civitas_admin -- this database is not in
-- bootstrap-postgres.sh's EVIDENCE_SUITE_DBS admin-readonly grant list):
-- only contracts.legal_contract_reviews carries a status column; the
-- other 8 do not.
--
-- Index naming: idx_<table>_tenant[_status], reusing the table's own name
-- verbatim since 8 of the 9 already carry the legal_ prefix (matching
-- tranches 3-4's "don't double the prefix" rule). The two exceptions:
-- _outbox.messages_legacy gets legal_ prepended
-- (idx_legal_messages_legacy_tenant), matching tranche 4's admin-service
-- handling of the same recurring fleet-wide outbox table name; and
-- documents.document_versions -- which does not carry the legal_ prefix
-- either -- similarly becomes idx_legal_document_versions_tenant. Checked
-- information_schema.tables for bare-name collisions across schemas in
-- civitas_legal: hearings.legal_opinions and opinions.legal_opinions do
-- share a bare name across two schemas, but neither is one of this
-- tranche's 9 target tables (both already have a leading tenant_id index),
-- so it does not affect this file's naming. Checked pg_indexes for all 9
-- tables: no existing index anywhere near these names (only *_pkey,
-- unique constraint indexes and feature-specific idx_* names), so none of
-- these CREATE INDEX CONCURRENTLY IF NOT EXISTS statements silently skip a
-- pre-existing, differently-purposed index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-4's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_legal_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS cases.idx_legal_parties_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_legal_clearances_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_legal_contract_reviews_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS contracts.idx_legal_contract_reviews_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS documents.idx_legal_document_versions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS hearings.idx_legal_orders_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS notices.idx_legal_notice_responses_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS reminders.idx_legal_reminders_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS settlements.idx_legal_lok_adalat_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_parties_tenant
  ON cases.legal_parties (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_clearances_tenant
  ON contracts.legal_clearances (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_contract_reviews_tenant
  ON contracts.legal_contract_reviews (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_contract_reviews_tenant_status
  ON contracts.legal_contract_reviews (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_document_versions_tenant
  ON documents.document_versions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_orders_tenant
  ON hearings.legal_orders (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_notice_responses_tenant
  ON notices.legal_notice_responses (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_reminders_tenant
  ON reminders.legal_reminders (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_lok_adalat_tenant
  ON settlements.legal_lok_adalat (tenant_id);
