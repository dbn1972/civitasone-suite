-- 0075_disbursement_file_issuances_list_idx.sql
-- GAP-PAYROLL-DISBURSEMENT-03: GET /v1/payroll/disbursement/files lists the
-- tenant's issued bank files newest-first (with their signed/unsigned state).
-- Stable ORDER BY (created_at DESC, id DESC) is served by this index.
--
-- Rollback:
--   DROP INDEX IF EXISTS payroll.idx_disbursement_file_issuances_tenant_created;
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_disbursement_file_issuances_tenant_created
  ON payroll.disbursement_file_issuances (tenant_id, created_at DESC, id DESC);
