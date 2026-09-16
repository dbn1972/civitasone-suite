-- 0018_perf016_tenant_indexes.sql
-- PERF-016 (remainder of PERF-002): continues the fleet-wide tenant_id
-- leading-index backlog. This tranche (5) covers procurement-service (11)
-- + grant-service (10) as its main pair, plus legal-service (9),
-- notification-service (8), and this service -- billing-service (7) --
-- re-measured live on 2026-09-16 via `node scripts/ci/tenant-index-guard.mjs
-- --report` against a freshly bootstrapped postgis/postgis:16-3.4 cluster:
-- 16 RLS tables / 7 missing, matching the gap report row's own figure
-- exactly.
--
-- This file is the billing-service half: 7 tables across the
-- _outbox/invoices/payments/plans/subscriptions schemas, with no index
-- whose leading column is tenant_id.
--
-- Every table below gets the bare leading tenant_id index (the guard's
-- minimum bar). Tables that also have a `status` column additionally get
-- the (tenant_id, status) composite, matching the precedent set by
-- 0019_perf002_tenant_indexes.sql (works-service) and tranches 1-4 --
-- checked directly against this service's live information_schema (as
-- billing_svc, not civitas_admin -- this database IS in
-- bootstrap-postgres.sh's EVIDENCE_SUITE_DBS admin-readonly grant list, but
-- the service role was used anyway for consistency with grant-service and
-- legal-service in this same tranche, neither of which is on that list):
-- invoices.billing_invoice_approvals and payments.billing_gateway_txns
-- carry a status column; the other 5 do not.
--
-- Index naming: idx_<table>_tenant[_status], reusing the table's own name
-- verbatim since all 6 non-outbox tables already carry the billing_
-- prefix (matching tranches 3-4's "don't double the prefix" rule);
-- _outbox.messages_legacy gets billing_ prepended
-- (idx_billing_messages_legacy_tenant), matching tranche 4's admin-service
-- handling of the same recurring fleet-wide outbox table name. Checked
-- information_schema.tables for bare-name collisions across schemas in
-- civitas_billing: none found. Checked pg_indexes for all 7 tables: no
-- existing index anywhere near these names (only *_pkey, unique
-- constraint indexes and feature-specific idx_* names), so none of these
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS statements silently skip a
-- pre-existing, differently-purposed index.
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one -- this file does
-- not -- so CONCURRENTLY is safe here, matching tranches 1-4's precedent.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS _outbox.idx_billing_messages_legacy_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS invoices.idx_billing_invoice_approvals_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS invoices.idx_billing_invoice_approvals_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS invoices.idx_billing_invoice_items_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_billing_gateway_txns_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS payments.idx_billing_gateway_txns_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS plans.idx_billing_plan_features_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS plans.idx_billing_plans_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS subscriptions.idx_billing_trials_tenant;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_messages_legacy_tenant
  ON _outbox.messages_legacy (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_invoice_approvals_tenant
  ON invoices.billing_invoice_approvals (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_invoice_approvals_tenant_status
  ON invoices.billing_invoice_approvals (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_invoice_items_tenant
  ON invoices.billing_invoice_items (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_gateway_txns_tenant
  ON payments.billing_gateway_txns (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_gateway_txns_tenant_status
  ON payments.billing_gateway_txns (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_plan_features_tenant
  ON plans.billing_plan_features (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_plans_tenant
  ON plans.billing_plans (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_trials_tenant
  ON subscriptions.billing_trials (tenant_id);
