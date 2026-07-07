-- Migration: 0009_batch_serial_tracking.sql
-- Purpose: Add batch tracking and serial number tracking tables for inventory items.
-- Rollback: DROP TABLE IF EXISTS inventory.serial_numbers; DROP TABLE IF EXISTS inventory.batches;
-- Affected services: inventory-service
-- Requirements: 14.5, 14.6

SET lock_timeout = '5s';

-- ── Batches table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  item_id      uuid         NOT NULL,
  batch_number varchar(64)  NOT NULL,
  mfg_date     date         NOT NULL,
  expiry_date  date         NOT NULL,
  qty          integer      NOT NULL DEFAULT 0,
  status       varchar(24)  NOT NULL DEFAULT 'active',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         NOT NULL,
  updated_by   uuid         NOT NULL,
  version      integer      NOT NULL DEFAULT 1,
  CONSTRAINT fk_inv_batch_item FOREIGN KEY (item_id) REFERENCES inventory.items(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_batches_tenant ON inventory.batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_batches_item ON inventory.batches(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_batches_expiry ON inventory.batches(tenant_id, expiry_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_batches_tenant_item_number ON inventory.batches(tenant_id, item_id, batch_number);

-- Status check constraint
ALTER TABLE inventory.batches DROP CONSTRAINT IF EXISTS chk_batches_status;
ALTER TABLE inventory.batches ADD CONSTRAINT chk_batches_status
  CHECK (status IN ('active', 'expired', 'depleted', 'quarantine'));

-- ── Serial Numbers table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.serial_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  item_id       uuid         NOT NULL,
  batch_id      uuid,
  serial_number varchar(128) NOT NULL,
  status        varchar(24)  NOT NULL DEFAULT 'available',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1,
  CONSTRAINT fk_inv_serial_item  FOREIGN KEY (item_id)  REFERENCES inventory.items(id),
  CONSTRAINT fk_inv_serial_batch FOREIGN KEY (batch_id) REFERENCES inventory.batches(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_serials_tenant ON inventory.serial_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_serials_item ON inventory.serial_numbers(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_serials_batch ON inventory.serial_numbers(batch_id);
-- Unique serial number per item per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_serials_tenant_item_serial ON inventory.serial_numbers(tenant_id, item_id, serial_number);

-- Status check constraint
ALTER TABLE inventory.serial_numbers DROP CONSTRAINT IF EXISTS chk_serial_status;
ALTER TABLE inventory.serial_numbers ADD CONSTRAINT chk_serial_status
  CHECK (status IN ('available', 'issued', 'returned', 'scrapped'));

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE inventory.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.batches FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON inventory.batches
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE inventory.serial_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.serial_numbers FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON inventory.serial_numbers
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  GRANT ALL ON inventory.batches TO inventory_svc;
  GRANT ALL ON inventory.serial_numbers TO inventory_svc;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
