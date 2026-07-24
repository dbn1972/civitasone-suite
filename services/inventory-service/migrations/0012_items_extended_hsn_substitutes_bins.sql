-- 0012_items_extended_hsn_substitutes_bins.sql
-- Purpose: Extend items table with HSN/GST tax classification, reorder_max,
--   shelf life / batch+serial tracking flags (SVC-051, SVC-055).
--   Create new tables: item_substitutes, bins, custodians, reservations,
--   goods_returns (SVC-052..055).
-- Rollback:
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS reorder_max;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS hsn_code;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS gst_rate;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS tax_class;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS shelf_life_days;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS requires_batch_tracking;
--   ALTER TABLE inventory.items DROP COLUMN IF EXISTS requires_serial_tracking;
--   DROP TABLE IF EXISTS inventory.goods_returns;
--   DROP TABLE IF EXISTS inventory.reservations;
--   DROP TABLE IF EXISTS inventory.custodians;
--   DROP TABLE IF EXISTS inventory.bins;
--   DROP TABLE IF EXISTS inventory.item_substitutes;
-- Affected services: inventory-service

SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. New columns on inventory.items
-- ═══════════════════════════════════════════════════════════════════════════════

-- reorder_max (SVC-051)
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS reorder_max INTEGER NOT NULL DEFAULT 0;

-- HSN/GST tax classification (SVC-051)
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(16);
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5, 2);
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS tax_class VARCHAR(32);

-- Shelf life / expiry tracking flags (SVC-055)
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS requires_batch_tracking BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS requires_serial_tracking BOOLEAN NOT NULL DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. item_substitutes — allowed replacement items with priority + conversion
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory.item_substitutes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL,
  item_id           UUID         NOT NULL,
  substitute_id     UUID         NOT NULL,
  priority          INTEGER      NOT NULL DEFAULT 1,
  conversion_factor NUMERIC(10, 4) NOT NULL DEFAULT 1.0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by        UUID         NOT NULL,
  CONSTRAINT fk_item_sub_item FOREIGN KEY (item_id) REFERENCES inventory.items(id),
  CONSTRAINT fk_item_sub_substitute FOREIGN KEY (substitute_id) REFERENCES inventory.items(id)
);

CREATE INDEX IF NOT EXISTS idx_item_subs_tenant ON inventory.item_substitutes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_subs_item ON inventory.item_substitutes(tenant_id, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_subs_pair ON inventory.item_substitutes(tenant_id, item_id, substitute_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. bins — physical storage positions within a store
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory.bins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID         NOT NULL,
  store_id   UUID         NOT NULL,
  code       VARCHAR(64)  NOT NULL,
  aisle      VARCHAR(16),
  rack       VARCHAR(16),
  shelf      VARCHAR(16),
  capacity   INTEGER,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by UUID         NOT NULL,
  updated_by UUID         NOT NULL,
  version    INTEGER      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_bins_tenant ON inventory.bins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bins_store ON inventory.bins(tenant_id, store_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bins_store_code ON inventory.bins(tenant_id, store_id, code);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. custodians — who is responsible for items in a store
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory.custodians (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL,
  store_id       UUID         NOT NULL,
  employee_ref   UUID         NOT NULL,
  designation    VARCHAR(120),
  effective_from DATE         NOT NULL,
  effective_to   DATE,
  status         VARCHAR(24)  NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by     UUID         NOT NULL,
  updated_by     UUID         NOT NULL,
  version        INTEGER      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_custodians_tenant ON inventory.custodians(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custodians_store ON inventory.custodians(tenant_id, store_id);

ALTER TABLE inventory.custodians DROP CONSTRAINT IF EXISTS chk_custodian_status;
ALTER TABLE inventory.custodians ADD CONSTRAINT chk_custodian_status
  CHECK (status IN ('active', 'inactive', 'transferred'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. reservations — items allocated against indent/PO (not yet issued)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory.reservations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL,
  item_id     UUID         NOT NULL,
  store_id    UUID         NOT NULL,
  qty         INTEGER      NOT NULL,
  ref_type    VARCHAR(32)  NOT NULL,
  ref_id      UUID         NOT NULL,
  status      VARCHAR(24)  NOT NULL DEFAULT 'active',
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  UUID         NOT NULL,
  updated_by  UUID         NOT NULL,
  version     INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT fk_reservation_item FOREIGN KEY (item_id) REFERENCES inventory.items(id),
  CONSTRAINT reservations_qty_positive CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON inventory.reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_item ON inventory.reservations(tenant_id, item_id, store_id);
CREATE INDEX IF NOT EXISTS idx_reservations_ref ON inventory.reservations(tenant_id, ref_type, ref_id);

ALTER TABLE inventory.reservations DROP CONSTRAINT IF EXISTS chk_reservation_status;
ALTER TABLE inventory.reservations ADD CONSTRAINT chk_reservation_status
  CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. goods_returns — returned/rejected items with QC gate
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory.goods_returns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL,
  original_issue_id UUID        NOT NULL,
  item_id          UUID         NOT NULL,
  store_id         UUID         NOT NULL,
  qty              INTEGER      NOT NULL,
  reason           VARCHAR(200) NOT NULL,
  qc_status        VARCHAR(24)  NOT NULL DEFAULT 'pending',
  qc_inspected_by  UUID,
  qc_inspected_at  TIMESTAMPTZ,
  qc_notes         VARCHAR(512),
  disposition      VARCHAR(24)  NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by       UUID         NOT NULL,
  updated_by       UUID         NOT NULL,
  version          INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT fk_returns_item FOREIGN KEY (item_id) REFERENCES inventory.items(id),
  CONSTRAINT goods_returns_qty_positive CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_goods_returns_tenant ON inventory.goods_returns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_goods_returns_item ON inventory.goods_returns(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_goods_returns_issue ON inventory.goods_returns(tenant_id, original_issue_id);

ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_qc_status;
ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_qc_status
  CHECK (qc_status IN ('pending', 'passed', 'failed'));

ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_disposition;
ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_disposition
  CHECK (disposition IN ('pending', 'restock', 'scrap', 'return_to_vendor'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RLS — tenant isolation on all new tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE inventory.item_substitutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.item_substitutes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'item_substitutes' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.item_substitutes
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE inventory.bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.bins FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bins' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.bins
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE inventory.custodians ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.custodians FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'custodians' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.custodians
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE inventory.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reservations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'reservations' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.reservations
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE inventory.goods_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.goods_returns FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'goods_returns' AND schemaname = 'inventory' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON inventory.goods_returns
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Grants — service role
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  GRANT ALL ON inventory.item_substitutes TO inventory_svc;
  GRANT ALL ON inventory.bins TO inventory_svc;
  GRANT ALL ON inventory.custodians TO inventory_svc;
  GRANT ALL ON inventory.reservations TO inventory_svc;
  GRANT ALL ON inventory.goods_returns TO inventory_svc;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
