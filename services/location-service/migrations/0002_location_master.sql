ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS type varchar(32) NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS lgd_code varchar(32),
  ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS jurisdiction_ref varchar(128),
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date;

CREATE INDEX IF NOT EXISTS idx_locations_parent ON location.locations(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_lgd ON location.locations(tenant_id, lgd_code);
CREATE INDEX IF NOT EXISTS idx_locations_type ON location.locations(tenant_id, type);
