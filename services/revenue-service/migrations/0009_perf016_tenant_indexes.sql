-- 0009_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. Tranche 1 (#1192) covered works-service (34) +
-- hrms-service (20); tranche 2 (#1353) covered asset-service (15) +
-- project-service (15); tranche 3 (#1393) covered citizen-service (14) +
-- estab-service (14). This tranche (4) covers the next two worst
-- offenders by missing-index count -- meeting-service and revenue-service,
-- 13 and 12 missing respectively (re-measured live on 2026-09-16 via
-- `node scripts/ci/tenant-index-guard.mjs --report` against a freshly
-- bootstrapped postgis/postgis:16-3.4 cluster: meeting 23 RLS tables / 13
-- missing, revenue 22 RLS tables / 12 missing -- both figures already
-- match the gap report's own numbers, unlike citizen/estab in tranche 3).
--
-- This file is the revenue-service half: 12 tables across the
-- arrears/assessment/bbps/billing/collection/rates schemas, with no index
-- whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-3 --
-- checked directly against this service's live information_schema, not
-- inferred from migration text: arrears.instalment_plans,
-- arrears.instalments, arrears.recovery_referrals, arrears.write_offs,
-- assessment.demands, billing.bills, collection.receipts and
-- collection.refunds carry a status column; bbps.biller_config,
-- collection.adjustments, rates.penalty_rules and rates.rebate_rules do
-- not.
--
-- Index naming: idx_revenue_<table>_tenant[_status]. None of these 12
-- bare table names already carry a revenue_ prefix (unlike e.g.
-- meeting-service's meeting_documents in this same tranche), so all 12
-- get revenue_ prepended, matching tranche 3's "prepend when the table
-- doesn't already carry the service prefix" rule. No bare-name collisions
-- across schemas here -- all 12 table names are unique fleet-wide within
-- this database.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-3's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_instalment_plans_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_instalment_plans_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_instalments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_instalments_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_recovery_referrals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_recovery_referrals_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_write_offs_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS arrears.idx_revenue_write_offs_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_revenue_demands_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS assessment.idx_revenue_demands_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS bbps.idx_revenue_biller_config_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS billing.idx_revenue_bills_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS billing.idx_revenue_bills_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS collection.idx_revenue_adjustments_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS collection.idx_revenue_receipts_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS collection.idx_revenue_receipts_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS collection.idx_revenue_refunds_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS collection.idx_revenue_refunds_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS rates.idx_revenue_penalty_rules_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS rates.idx_revenue_rebate_rules_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_instalment_plans_tenant
  ON arrears.instalment_plans (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_instalment_plans_tenant_status
  ON arrears.instalment_plans (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_instalments_tenant
  ON arrears.instalments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_instalments_tenant_status
  ON arrears.instalments (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_recovery_referrals_tenant
  ON arrears.recovery_referrals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_recovery_referrals_tenant_status
  ON arrears.recovery_referrals (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_write_offs_tenant
  ON arrears.write_offs (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_write_offs_tenant_status
  ON arrears.write_offs (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_demands_tenant
  ON assessment.demands (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_demands_tenant_status
  ON assessment.demands (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_biller_config_tenant
  ON bbps.biller_config (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_bills_tenant
  ON billing.bills (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_bills_tenant_status
  ON billing.bills (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_adjustments_tenant
  ON collection.adjustments (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_receipts_tenant
  ON collection.receipts (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_receipts_tenant_status
  ON collection.receipts (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_refunds_tenant
  ON collection.refunds (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_refunds_tenant_status
  ON collection.refunds (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_penalty_rules_tenant
  ON rates.penalty_rules (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_rebate_rules_tenant
  ON rates.rebate_rules (tenant_id);
