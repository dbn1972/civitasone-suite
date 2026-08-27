CREATE INDEX IF NOT EXISTS idx_vendors_tenant
  ON vendor.procurement_vendors (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_po_tenant
  ON po.procurement_pos (tenant_id, created_at DESC);
