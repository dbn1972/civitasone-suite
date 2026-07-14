-- 0011_cost_layers_cycle_counts.sql
-- Purpose (INV-MIGRATIONS): create the two inventory domain tables that exist
-- in the Drizzle schema (src/modules/costing/schema.ts, cycle-count/schema.ts)
-- but were never migrated into civitas_inventory — every costing / cycle-count
-- route 500'd on "relation does not exist".
--
--   inventory.cost_layers  — FIFO/WAVG cost layers (money in bigint paise)
--   inventory.cycle_counts — physical-vs-system count variance + approval
--
-- RLS: fail-closed tenant isolation (NULLIF form) + FORCE, matching the rest of
-- the inventory schema. Rollback:
--   DROP TABLE IF EXISTS inventory.cost_layers, inventory.cycle_counts;

SET lock_timeout = '5s';

-- ── cost_layers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.cost_layers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  item_id          UUID NOT NULL,
  warehouse_id     UUID NOT NULL,
  receipt_date     TIMESTAMPTZ NOT NULL,
  qty              INT  NOT NULL,
  remaining_qty    INT  NOT NULL,
  unit_cost_paise  BIGINT NOT NULL,
  receipt_id       UUID,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID NOT NULL,
  version          INT NOT NULL DEFAULT 1,
  CONSTRAINT cost_layers_qty_nonneg CHECK (qty >= 0 AND remaining_qty >= 0),
  CONSTRAINT cost_layers_remaining_le_qty CHECK (remaining_qty <= qty),
  CONSTRAINT cost_layers_unit_cost_nonneg CHECK (unit_cost_paise >= 0)
);

ALTER TABLE inventory.cost_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.cost_layers FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_layers' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.cost_layers
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- FIFO consumption scans open layers by (item, warehouse) in receipt order.
CREATE INDEX IF NOT EXISTS idx_cost_layers_fifo
  ON inventory.cost_layers (tenant_id, item_id, warehouse_id, receipt_date)
  WHERE remaining_qty > 0;

-- ── cycle_counts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.cycle_counts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  item_id               UUID NOT NULL,
  warehouse_id          UUID NOT NULL,
  system_qty            INT NOT NULL,
  physical_qty          INT NOT NULL,
  variance              INT NOT NULL,
  abs_variance          INT NOT NULL,
  auto_adjust_threshold INT NOT NULL,
  reason_code           VARCHAR(64) NOT NULL,
  status                VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by           UUID,
  approved_at           TIMESTAMPTZ,
  rejected_by           UUID,
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  adjustment_id         UUID,
  counted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  CONSTRAINT cycle_counts_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'auto_adjusted')),
  CONSTRAINT cycle_counts_absvar_chk CHECK (abs_variance >= 0)
);

ALTER TABLE inventory.cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.cycle_counts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cycle_counts' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.cycle_counts
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- Pending-count review queue, per tenant.
CREATE INDEX IF NOT EXISTS idx_cycle_counts_pending
  ON inventory.cycle_counts (tenant_id, status, counted_at);

-- Scanner / service role grants (mirrors the schema owner's default privileges).
GRANT SELECT, INSERT, UPDATE ON inventory.cost_layers, inventory.cycle_counts TO inventory_svc;
