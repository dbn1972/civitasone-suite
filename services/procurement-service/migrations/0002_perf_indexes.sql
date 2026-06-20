CREATE INDEX IF NOT EXISTS idx_vendors_tenant
  ON vendor.vendors (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_po_tenant
  ON po.purchase_orders (tenant_id, created_at DESC);
