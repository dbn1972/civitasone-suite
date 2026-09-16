-- 0038_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 1 (#1192) covered works-service (34) +
-- hrms-service (20); tranche 2 (#1353) covered asset-service (15) +
-- project-service (15); tranche 3 (#1393) covered citizen-service (14) +
-- estab-service (14); tranche 4 (#1408) covered meeting-service (13) +
-- revenue-service (12) + admin-service (7) + hrms-service (1). This tranche
-- (5) covers the current worst offender by missing-index count --
-- procurement-service, 11 missing (re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster: 39 RLS tables / 11 missing,
-- matching the gap report row's own figure exactly -- no staleness found
-- this time, unlike tranche 3/4's corrections).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-4 --
-- checked directly against this service's live information_schema (as
-- procurement_svc, not civitas_admin -- this database IS in
-- bootstrap-postgres.sh's EVIDENCE_SUITE_DBS admin-readonly grant list, but
-- the service role was used anyway for consistency with grant-service and
-- legal-service in this same tranche, neither of which is on that list):
-- payments.procurement_advances,
-- payments.procurement_debit_notes and vendor.procurement_empanelment carry a
-- status column; the other 8 do not.
--
-- Index naming: idx_<table>_tenant[_status], reusing the table's own name
-- verbatim since all 11 already carry the procurement_ prefix (matching
-- tranches 3-4's "don't double the prefix" rule) except _outbox.messages_legacy,
-- which gets procurement_ prepended (idx_procurement_messages_legacy_tenant),
-- matching tranche 4's admin-service handling of the same recurring
-- fleet-wide outbox table name. Checked information_schema.tables for
-- bare-name collisions across schemas in civitas_procurement: none found.
-- Checked pg_indexes for all 11 tables: no existing index anywhere near
-- these names (only *_pkey and feature-specific idx_* names), so none of
-- these CREATE INDEX CONCURRENTLY IF NOT EXISTS statements silently skip a
-- pre-existing, differently-purposed index of the same name.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-4's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_procurement_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS auction.idx_procurement_bids_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS grn.idx_procurement_grn_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS grn.idx_procurement_inspections_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS indent.idx_procurement_indent_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_procurement_advances_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_procurement_advances_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_procurement_debit_notes_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_procurement_debit_notes_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS po.idx_procurement_po_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS rfq.idx_procurement_rfq_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS vendor.idx_procurement_empanelment_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS vendor.idx_procurement_empanelment_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS vendor.idx_procurement_vendor_docs_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_bids_tenant
  ON auction.procurement_bids (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_grn_items_tenant
  ON grn.procurement_grn_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_inspections_tenant
  ON grn.procurement_inspections (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_indent_items_tenant
  ON indent.procurement_indent_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_advances_tenant
  ON payments.procurement_advances (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_advances_tenant_status
  ON payments.procurement_advances (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_debit_notes_tenant
  ON payments.procurement_debit_notes (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_debit_notes_tenant_status
  ON payments.procurement_debit_notes (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_po_items_tenant
  ON po.procurement_po_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_rfq_items_tenant
  ON rfq.procurement_rfq_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_empanelment_tenant
  ON vendor.procurement_empanelment (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_empanelment_tenant_status
  ON vendor.procurement_empanelment (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procurement_vendor_docs_tenant
  ON vendor.procurement_vendor_docs (tenant_id);
