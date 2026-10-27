-- 0024_gstn_return_history.sql
-- GAP-BILLING-GSTN-05 (UAT B4, owner decision 2026-10-27): persist every GST return filed through
-- the billing GSTN console so an officer can see what was already filed for a GSTIN and period
-- (filing history) and is warned before filing the same period and type twice. Tenant-owned,
-- money as bigint paise, FORCE RLS in this same migration.
-- Idempotent. Rollback: DROP TABLE invoices.billing_gstn_returns;
-- Affected services: billing-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS invoices.billing_gstn_returns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  gstin               varchar(15) NOT NULL,
  return_period       char(7)     NOT NULL,
  return_type         varchar(8)  NOT NULL,
  reference_id        text        NOT NULL,
  status              varchar(16) NOT NULL DEFAULT 'submitted',
  total_taxable_minor bigint      NOT NULL DEFAULT 0,
  total_cgst_minor    bigint      NOT NULL DEFAULT 0,
  total_sgst_minor    bigint      NOT NULL DEFAULT 0,
  total_igst_minor    bigint      NOT NULL DEFAULT 0,
  filed_at            timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_by          uuid        NOT NULL,
  version             integer     NOT NULL DEFAULT 1,
  CONSTRAINT ck_billing_gstn_returns_period CHECK (return_period ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  CONSTRAINT ck_billing_gstn_returns_type CHECK (return_type IN ('GSTR1', 'GSTR3B', 'GSTR9', 'GSTR9C')),
  CONSTRAINT ck_billing_gstn_returns_status CHECK (status IN ('submitted', 'processing', 'filed', 'rejected')),
  CONSTRAINT ck_billing_gstn_returns_amounts CHECK (
    total_taxable_minor >= 0 AND total_cgst_minor >= 0 AND total_sgst_minor >= 0 AND total_igst_minor >= 0
  ),
  CONSTRAINT uq_billing_gstn_returns_ref UNIQUE (tenant_id, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_gstn_returns_tenant_gstin_period
  ON invoices.billing_gstn_returns (tenant_id, gstin, return_period, filed_at DESC);

ALTER TABLE invoices.billing_gstn_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices.billing_gstn_returns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON invoices.billing_gstn_returns;
CREATE POLICY tenant_isolation_policy ON invoices.billing_gstn_returns
  USING (tenant_id = plans.current_tenant_id())
  WITH CHECK (tenant_id = plans.current_tenant_id());
