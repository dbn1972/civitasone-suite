-- stock-service e-Way Bill migration
-- Role: stock_svc on civitas_stock
-- Applied AFTER 0003_rls_tenant_isolation.sql

CREATE SCHEMA IF NOT EXISTS eway_bill;

CREATE TABLE IF NOT EXISTS eway_bill.eway_bills (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  ewb_no            text,
  invoice_id        uuid,
  dispatch_id       uuid,
  supply_type       varchar(16) NOT NULL
                                CHECK (supply_type IN ('outward', 'inward')),
  sub_supply_type   varchar(24) NOT NULL
                                CHECK (sub_supply_type IN ('supply', 'export', 'job_work', 'for_own_use', 'sales_return', 'others')),
  doc_type          varchar(16) NOT NULL
                                CHECK (doc_type IN ('invoice', 'bill', 'challan', 'credit_note', 'others')),
  doc_no            text        NOT NULL,
  doc_date          date        NOT NULL,
  from_gstin        text        NOT NULL,
  from_name         text        NOT NULL,
  from_addr         text        NOT NULL,
  from_pin          text        NOT NULL,
  from_state_code   text        NOT NULL,
  to_gstin          text,
  to_name           text        NOT NULL,
  to_addr           text        NOT NULL,
  to_pin            text        NOT NULL,
  to_state_code     text        NOT NULL,
  total_value_minor bigint      NOT NULL,
  hsn_code          text        NOT NULL,
  transport_mode    varchar(8)  CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship')),
  vehicle_no        text,
  transporter_id    text,
  valid_until       timestamptz,
  status            varchar(16) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'active', 'cancelled', 'expired', 'failed')),
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_eway_bills_tenant     ON eway_bill.eway_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_eway_bills_ewb_no     ON eway_bill.eway_bills(ewb_no) WHERE ewb_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eway_bills_status     ON eway_bill.eway_bills(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_eway_bills_invoice    ON eway_bill.eway_bills(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eway_bills_dispatch   ON eway_bill.eway_bills(dispatch_id) WHERE dispatch_id IS NOT NULL;

-- RLS for tenant isolation
ALTER TABLE eway_bill.eway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE eway_bill.eway_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON eway_bill.eway_bills;
CREATE POLICY tenant_isolation ON eway_bill.eway_bills
  USING (tenant_id = item.current_tenant_id());

-- GRANT to stock_svc role
GRANT USAGE ON SCHEMA eway_bill TO stock_svc;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA eway_bill TO stock_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA eway_bill GRANT SELECT, INSERT, UPDATE ON TABLES TO stock_svc;
