-- 0071_perf002_tenant_indexes.sql
-- PERF-002: RLS'd tenant tables with no index whose leading column is
-- tenant_id force a sequential scan under RLS on every tenant-scoped query,
-- regardless of any other WHERE clause. First tranche: the four finance
-- ledger tables named in the gap's evidence (all four were PK-only —
-- verified against the live dev cluster on 2026-09-08, not just the
-- 2026-09-07 audit's migration-text read).
--
-- CREATE INDEX CONCURRENTLY: must run outside a transaction block. This
-- repo's migration runner (scripts/ci/bootstrap-postgres.sh) applies each
-- file via a single `psql -f`, which does not wrap statements in an
-- implicit transaction unless the file itself opens one — this file does
-- not — so CONCURRENTLY is safe here, matching the precedent in
-- 0063_drop_redundant_indexes.sql. A real production rollout should still
-- run this file's statements one at a time (CONCURRENTLY index builds hold
-- a snapshot and cannot run inside any surrounding transaction).
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_ap_ledger_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_ap_ledger_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_ar_ledger_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_ar_ledger_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_bank_reconciliation_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS gl.idx_finance_bank_reconciliation_tenant_status;
--   DROP INDEX CONCURRENTLY IF EXISTS treasury.idx_finance_debt_tenant;
--   DROP INDEX CONCURRENTLY IF EXISTS treasury.idx_finance_debt_tenant_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_ap_ledger_tenant
  ON gl.finance_ap_ledger (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_ap_ledger_tenant_status
  ON gl.finance_ap_ledger (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_ar_ledger_tenant
  ON gl.finance_ar_ledger (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_ar_ledger_tenant_status
  ON gl.finance_ar_ledger (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_bank_reconciliation_tenant
  ON gl.finance_bank_reconciliation (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_bank_reconciliation_tenant_status
  ON gl.finance_bank_reconciliation (tenant_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_debt_tenant
  ON treasury.finance_debt (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_debt_tenant_status
  ON treasury.finance_debt (tenant_id, status);
