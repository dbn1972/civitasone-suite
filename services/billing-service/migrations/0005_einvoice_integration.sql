-- e-Invoice (NIC IRN) integration for GST compliance
CREATE SCHEMA IF NOT EXISTS einvoice;

CREATE TABLE IF NOT EXISTS einvoice.billing_einvoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  irn text,
  ack_no text,
  ack_date timestamptz,
  signed_invoice text,
  signed_qr_code text,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','cancelled','failed')),
  error_message text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_einvoice_tenant ON einvoice.billing_einvoice_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_invoice ON einvoice.billing_einvoice_requests(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_einvoice_irn ON einvoice.billing_einvoice_requests(irn) WHERE irn IS NOT NULL;

-- RLS policy for tenant isolation (mirrors pattern from 0003)
ALTER TABLE einvoice.billing_einvoice_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON einvoice.billing_einvoice_requests
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
