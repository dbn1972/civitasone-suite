-- 0015_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 5's main pair is procurement-service +
-- grant-service (see procurement-service's own 0038_perf016_tenant_indexes.sql),
-- the two worst offenders by missing-index count re-measured live on
-- 2026-09-16 via `node scripts/ci/tenant-index-guard.mjs --report` against a
-- freshly bootstrapped postgis/postgis:16-3.4 cluster: procurement 39 RLS
-- tables / 11 missing, grant 17 RLS tables / 10 missing -- both match the
-- gap report row's own figures exactly, no staleness found this time.
--
-- This file is the grant-service half: 10 tables across the
-- _outbox/application/beneficiary/disbursement/scheme/utilisation schemas,
-- with no index whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-4 --
-- checked directly against this service's live information_schema (as
-- grant_svc, not civitas_admin -- this database is not in
-- bootstrap-postgres.sh's EVIDENCE_SUITE_DBS admin-readonly grant list):
-- beneficiary.grant_aadhaar_links, beneficiary.grant_bank_accounts,
-- disbursement.grant_disbursements, utilisation.grant_audit_paras and
-- utilisation.grant_compliance_reports carry a status column; the other 5
-- do not.
--
-- Index naming: idx_<table>_tenant[_status], reusing the table's own name
-- verbatim since all 10 already carry the grant_ prefix (matching tranches
-- 3-4's "don't double the prefix" rule) except _outbox.messages_legacy,
-- which gets grant_ prepended (idx_grant_messages_legacy_tenant), matching
-- tranche 4's admin-service handling of the same recurring fleet-wide
-- outbox table name. Checked information_schema.tables for bare-name
-- collisions across schemas in civitas_grant: none found. Checked
-- pg_indexes for all 10 tables: no existing index anywhere near these
-- names (only *_pkey, unique constraint indexes and feature-specific idx_*
-- names), so none of these CREATE INDEX CONCURRENTLY IF NOT EXISTS
-- statements silently skip a pre-existing, differently-purposed index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-4's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_grant_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS application.idx_grant_app_documents_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS application.idx_grant_scores_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS beneficiary.idx_grant_aadhaar_links_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS beneficiary.idx_grant_aadhaar_links_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS beneficiary.idx_grant_bank_accounts_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS beneficiary.idx_grant_bank_accounts_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS disbursement.idx_grant_disbursements_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS disbursement.idx_grant_disbursements_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS disbursement.idx_grant_pfms_records_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS scheme.idx_grant_eligibility_criteria_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS utilisation.idx_grant_audit_paras_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS utilisation.idx_grant_audit_paras_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS utilisation.idx_grant_compliance_reports_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS utilisation.idx_grant_compliance_reports_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_app_documents_tenant
  ON application.grant_app_documents (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_scores_tenant
  ON application.grant_scores (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_aadhaar_links_tenant
  ON beneficiary.grant_aadhaar_links (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_aadhaar_links_tenant_status
  ON beneficiary.grant_aadhaar_links (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_bank_accounts_tenant
  ON beneficiary.grant_bank_accounts (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_bank_accounts_tenant_status
  ON beneficiary.grant_bank_accounts (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_disbursements_tenant
  ON disbursement.grant_disbursements (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_disbursements_tenant_status
  ON disbursement.grant_disbursements (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_pfms_records_tenant
  ON disbursement.grant_pfms_records (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_eligibility_criteria_tenant
  ON scheme.grant_eligibility_criteria (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_audit_paras_tenant
  ON utilisation.grant_audit_paras (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_audit_paras_tenant_status
  ON utilisation.grant_audit_paras (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_compliance_reports_tenant
  ON utilisation.grant_compliance_reports (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grant_compliance_reports_tenant_status
  ON utilisation.grant_compliance_reports (tenant_id, status);
