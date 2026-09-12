-- 0022_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): works-service is the worst offender
-- fleet-wide by missing-index count. Measured live against a freshly
-- bootstrapped cluster on 2026-09-12 via
-- `node scripts/ci/tenant-index-guard.mjs --report`: 49 RLS'd tenant tables
-- in the `works` schema, 34 with no index whose leading column is
-- tenant_id (all in works.works.*, all confirmed PK-only for tenant_id).
-- This migration is the works-service half of PERF-016's first tranche
-- (works-service + hrms-service, 54 of the fleet's 254 remaining tables;
-- see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md PERF-016 for the rest).
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql and finance-service's
-- 0071_perf002_tenant_indexes.sql — `status` is the most common
-- tenant-scoped filter fleet-wide (see tenant-index-guard.mjs's own
-- has_tenant_status_composite check). No (tenant_id, created_at)
-- composites here: that shape was scoped to the original evidence's "12
-- widest tables by column count" sub-goal (0019/0136), not part of
-- PERF-016's DoD (0 tables with no leading tenant_id index).
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one — this file does
-- not — so CONCURRENTLY is safe here, matching the precedent in
-- 0019_perf002_tenant_indexes.sql / finance-service's
-- 0071_perf002_tenant_indexes.sql.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_account_compilations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_account_compilations_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_administrative_approvals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_administrative_approvals_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_authorities_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_awards_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_awards_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_bill_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_bill_recoveries_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_bills_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_bills_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_boq_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_financial_targets_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_issue_observations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_material_coefficients_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_measurement_books_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_measurement_books_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_measurements_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_physical_completions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_physical_targets_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_pre_tenders_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_pre_tenders_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_programs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_proposer_types_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_quotation_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_quotations_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_recapitulation_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_schedule_a_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_scope_progress_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_technical_sanctions_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_technical_sanctions_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_tenders_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_closures_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_coa_mappings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_issues_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_issues_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_office_mappings_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_photos_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_scopes_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_splits_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_splits_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_sub_types_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS works.idx_works_work_types_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_account_compilations_tenant
  ON works.account_compilations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_account_compilations_tenant_status
  ON works.account_compilations (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_administrative_approvals_tenant
  ON works.administrative_approvals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_administrative_approvals_tenant_status
  ON works.administrative_approvals (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_authorities_tenant
  ON works.authorities (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_awards_tenant
  ON works.awards (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_awards_tenant_status
  ON works.awards (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_bill_items_tenant
  ON works.bill_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_bill_recoveries_tenant
  ON works.bill_recoveries (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_bills_tenant
  ON works.bills (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_bills_tenant_status
  ON works.bills (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_boq_items_tenant
  ON works.boq_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_financial_targets_tenant
  ON works.financial_targets (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_issue_observations_tenant
  ON works.issue_observations (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_material_coefficients_tenant
  ON works.material_coefficients (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_measurement_books_tenant
  ON works.measurement_books (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_measurement_books_tenant_status
  ON works.measurement_books (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_measurements_tenant
  ON works.measurements (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_physical_completions_tenant
  ON works.physical_completions (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_physical_targets_tenant
  ON works.physical_targets (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_pre_tenders_tenant
  ON works.pre_tenders (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_pre_tenders_tenant_status
  ON works.pre_tenders (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_programs_tenant
  ON works.programs (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_proposer_types_tenant
  ON works.proposer_types (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_quotation_items_tenant
  ON works.quotation_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_quotations_tenant
  ON works.quotations (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_recapitulation_tenant
  ON works.recapitulation (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_schedule_a_items_tenant
  ON works.schedule_a_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_scope_progress_tenant
  ON works.scope_progress (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_technical_sanctions_tenant
  ON works.technical_sanctions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_technical_sanctions_tenant_status
  ON works.technical_sanctions (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_tenders_tenant
  ON works.tenders (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_closures_tenant
  ON works.work_closures (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_coa_mappings_tenant
  ON works.work_coa_mappings (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_issues_tenant
  ON works.work_issues (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_issues_tenant_status
  ON works.work_issues (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_office_mappings_tenant
  ON works.work_office_mappings (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_photos_tenant
  ON works.work_photos (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_scopes_tenant
  ON works.work_scopes (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_splits_tenant
  ON works.work_splits (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_splits_tenant_status
  ON works.work_splits (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_sub_types_tenant
  ON works.work_sub_types (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_works_work_types_tenant
  ON works.work_types (tenant_id);
