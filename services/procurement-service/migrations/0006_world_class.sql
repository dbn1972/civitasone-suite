CREATE TABLE IF NOT EXISTS procurement.vendor_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, vendor_id UUID NOT NULL,
  reason TEXT NOT NULL, blacklisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blacklisted_by UUID NOT NULL, reinstated_at TIMESTAMPTZ, status VARCHAR(16) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS procurement.three_way_match (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, po_id UUID NOT NULL, grn_id UUID, invoice_id UUID,
  po_amount_minor BIGINT NOT NULL DEFAULT 0, grn_amount_minor BIGINT NOT NULL DEFAULT 0, invoice_amount_minor BIGINT NOT NULL DEFAULT 0,
  match_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (match_status IN ('pending','matched','mismatch','exception')),
  tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
