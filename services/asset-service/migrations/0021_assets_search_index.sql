CREATE INDEX IF NOT EXISTS idx_assets_search
  ON register.asset_assets
  USING gin(to_tsvector('simple', name || ' ' || code));
