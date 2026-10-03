-- 0079_tax_investment_proofs.sql
--
-- GAP-PAYROLL-TAX-DECLARATION-02: supporting documents (rent receipts, 80C /
-- 80D / 80G / other section proofs, home-loan interest certificates) attached
-- to an employee's tax-declaration line for a financial year.
--
-- The file itself lives in S3 (server-side encrypted, private); only metadata
-- is stored here. storage_key is server-generated and tenant/employee scoped:
--   payroll/<tenant>/tax-proofs/<fy>/<employee>/<uuid>.<ext>
-- and is never returned by any list endpoint.
--
-- Lifecycle: pending -> accepted | rejected (by a payroll officer other than
-- the employee), or pending -> removed (the employee withdrew it before
-- verification). legal_hold blocks the retention purge. Retention itself is a
-- per-tenant setting (0080) counted from the END of the financial year.
--
-- Idempotent. Rollback:
--   DROP TABLE IF EXISTS payroll.tax_proofs;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.tax_proofs (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  employee_id       uuid NOT NULL,
  fy                char(7) NOT NULL,
  line              varchar(24) NOT NULL,
  storage_key       text NOT NULL,
  filename          varchar(200) NOT NULL,
  content_type      varchar(64) NOT NULL,
  size_bytes        bigint NOT NULL,
  amount_minor      bigint,
  status            varchar(12) NOT NULL DEFAULT 'pending',
  rejection_reason  varchar(500),
  decided_by        uuid,
  decided_at        timestamptz,
  legal_hold        boolean NOT NULL DEFAULT false,
  legal_hold_reason varchar(500),
  legal_hold_by     uuid,
  legal_hold_at     timestamptz,
  uploaded_by       uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  removed_at        timestamptz,
  CONSTRAINT tax_proofs_line_chk CHECK (line IN ('rent', 'sec80c', 'sec80d', 'sec80g', 'home_loan_interest', 'other')),
  CONSTRAINT tax_proofs_status_chk CHECK (status IN ('pending', 'accepted', 'rejected', 'removed')),
  CONSTRAINT tax_proofs_type_chk CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT tax_proofs_size_chk CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT tax_proofs_amount_chk CHECK (amount_minor IS NULL OR amount_minor >= 0),
  CONSTRAINT tax_proofs_fy_chk CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT tax_proofs_reject_reason_chk CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT tax_proofs_hold_reason_chk CHECK (NOT legal_hold OR legal_hold_reason IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_proofs_storage_key ON payroll.tax_proofs (storage_key);
CREATE INDEX IF NOT EXISTS tax_proofs_employee_fy_idx
  ON payroll.tax_proofs (tenant_id, employee_id, fy, line, created_at, id);
CREATE INDEX IF NOT EXISTS tax_proofs_queue_idx
  ON payroll.tax_proofs (tenant_id, fy, status, created_at, id);

ALTER TABLE payroll.tax_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.tax_proofs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.tax_proofs;
CREATE POLICY tenant_isolation_policy ON payroll.tax_proofs
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- The scheduled retention purge must find WHICH tenants have purge-due rows.
-- SELECT-only platform-bypass policy (same convention as 0037/0039): the purge
-- itself then runs per tenant under the normal tenant policy.
DROP POLICY IF EXISTS platform_bypass_read_policy ON payroll.tax_proofs;
CREATE POLICY platform_bypass_read_policy ON payroll.tax_proofs
  FOR SELECT
  USING (current_setting('app.platform_bypass', true) = 'true');
