-- 0160_finance_accounting_basis_stores_memo.sql
-- UAT L2-N6 review (bundle 17, ERP-head decision under the owner delegated authority):
--  1. gl.finance_settings.accounting_basis: cash (DEFAULT) | accrual, per tenant. Indian government accounts are
--     cash based: expenditure is booked against the budget head when the bill is passed, stores are a memorandum
--     (stock register / valuation), not GL assets. An absent settings row reads as cash (approvals/domain.ts).
--  2. gl.stores_valuation_memo: one row per inventory-service stock movement received on finance.gl.post
--     (type inventory_movement). On cash basis it is the whole record (no GL journal); on accrual basis it also
--     carries the journal it posted, and it is what the GRNI clearing reads (gl/grni-clearing.ts).
-- Additive and idempotent (IF NOT EXISTS / DROP ... IF EXISTS). Rollback: DROP TABLE gl.stores_valuation_memo;
-- ALTER TABLE gl.finance_settings DROP COLUMN accounting_basis (only if no tenant relies on accrual).

SET lock_timeout = '5s';

ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS accounting_basis varchar(8) NOT NULL DEFAULT 'cash';
ALTER TABLE gl.finance_settings DROP CONSTRAINT IF EXISTS finance_settings_accounting_basis_check;
ALTER TABLE gl.finance_settings ADD CONSTRAINT finance_settings_accounting_basis_check
  CHECK (accounting_basis IN ('cash', 'accrual'));

CREATE TABLE IF NOT EXISTS gl.stores_valuation_memo (
  tenant_id    uuid        NOT NULL,
  movement_id  uuid        NOT NULL,
  kind         varchar(16) NOT NULL CHECK (kind IN ('receipt', 'issue')),
  total_minor  bigint      NOT NULL CHECK (total_minor >= 0),
  posting_date date        NOT NULL,
  store_id     uuid,
  ref_doc      varchar(64),
  ref_no       varchar(64),
  basis        varchar(8)  NOT NULL CHECK (basis IN ('cash', 'accrual')),
  journal_id   uuid,
  created_by   uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, movement_id)
);
CREATE INDEX IF NOT EXISTS idx_stores_valuation_memo_ref ON gl.stores_valuation_memo (tenant_id, ref_doc, ref_no);

ALTER TABLE gl.stores_valuation_memo ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.stores_valuation_memo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.stores_valuation_memo;
CREATE POLICY tenant_isolation_policy ON gl.stores_valuation_memo
  USING (tenant_id = budget.current_tenant_id())
  WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT USAGE ON SCHEMA gl TO finance_svc;
    GRANT SELECT, INSERT, UPDATE ON gl.stores_valuation_memo TO finance_svc;
  END IF;
END
$$;
