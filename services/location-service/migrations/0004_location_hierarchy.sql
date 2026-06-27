-- location-service: branch-office hierarchy.
-- Additive, idempotent, forward-only. Safe to re-run.
-- Adds self-referential parent (HQ tree), location type and LGD code.
-- NOTE: parent_id / type / lgd_code columns may already exist (0002_location_master.sql);
-- the IF NOT EXISTS guards keep this migration safe alongside that history.

ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES location.locations(id);

ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS type varchar(24) NOT NULL DEFAULT 'office';

ALTER TABLE location.locations
  ADD COLUMN IF NOT EXISTS lgd_code varchar(32);

-- Ensure the self-referential foreign key exists even when parent_id was created
-- earlier without it (0002_location_master.sql added the column without a FK).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'locations_parent_id_fkey'
      AND conrelid = 'location.locations'::regclass
  ) THEN
    ALTER TABLE location.locations
      ADD CONSTRAINT locations_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES location.locations(id);
  END IF;
END $$;

-- Index supporting parent -> children tree queries scoped per tenant.
CREATE INDEX IF NOT EXISTS idx_locations_tenant_parent
  ON location.locations(tenant_id, parent_id);
