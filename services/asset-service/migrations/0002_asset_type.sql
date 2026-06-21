-- asset-service: add asset_type column to register.asset_assets
-- Applied with asset_svc role on civitas_asset.

ALTER TABLE register.asset_assets
  ADD COLUMN IF NOT EXISTS asset_type varchar(16) NOT NULL DEFAULT 'other'
    CHECK (asset_type IN ('fixed','infra','movable','it','vehicle','other'));

ALTER TABLE maintenance.asset_work_orders
  ADD COLUMN IF NOT EXISTS maintenance_type varchar(16) NOT NULL DEFAULT 'corrective'
    CHECK (maintenance_type IN ('preventive','corrective','amc','breakdown'));

CREATE INDEX IF NOT EXISTS idx_assets_type ON register.asset_assets(tenant_id, asset_type);
