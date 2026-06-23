-- Asset tagging (barcode/QR) for physical verification
ALTER TABLE register.asset_assets
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE INDEX IF NOT EXISTS idx_asset_assets_barcode ON register.asset_assets(tenant_id, barcode);
