-- inventory-service domain deepening migration (0002).
-- Applied with inventory_svc on civitas_inventory ONLY (DB-per-service: no
-- cross-service FKs). Adds item master depth (categories, units, reorder +
-- valuation policy), store locations, and the stock movement model
-- (movements + lines + per-store balances + append-only ledger + reason codes).

-- ── Item master: categories ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(200) NOT NULL,
  code        varchar(64)  NOT NULL,
  parent_id   uuid,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_inv_categories_tenant ON inventory.categories(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_categories_tenant_code ON inventory.categories(tenant_id, code);

-- ── Item master: units of measure ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.uoms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(120) NOT NULL,
  symbol      varchar(16)  NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_inv_uoms_tenant ON inventory.uoms(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_uoms_tenant_symbol ON inventory.uoms(tenant_id, symbol);

-- ── Item master: extend items ──────────────────────────────────────────────
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS category_id      uuid;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS uom_id           uuid;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS item_type        varchar(16) NOT NULL DEFAULT 'consumable';
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS reorder_level    integer     NOT NULL DEFAULT 0;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS reorder_qty      integer     NOT NULL DEFAULT 0;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS valuation_method varchar(8)  NOT NULL DEFAULT 'WAVG';
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS unit_cost_minor  bigint      NOT NULL DEFAULT 0;
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS currency         char(3)     NOT NULL DEFAULT 'INR';
ALTER TABLE inventory.items ADD COLUMN IF NOT EXISTS is_active        boolean     NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE inventory.items
    ADD CONSTRAINT fk_inv_items_category FOREIGN KEY (category_id) REFERENCES inventory.categories(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE inventory.items
    ADD CONSTRAINT fk_inv_items_uom FOREIGN KEY (uom_id) REFERENCES inventory.uoms(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_inv_items_category ON inventory.items(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_reorder  ON inventory.items(tenant_id, reorder_level);

-- ── Stores ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        varchar(200) NOT NULL,
  code        varchar(64)  NOT NULL,
  location    varchar(256),
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  version     integer      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_inv_stores_tenant ON inventory.stores(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_stores_tenant_code ON inventory.stores(tenant_id, code);

-- ── Reason codes (adjustments / write-offs) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.reason_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        varchar(32)  NOT NULL,
  description varchar(200) NOT NULL,
  kind        varchar(16)  NOT NULL DEFAULT 'adjustment',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_reason_codes_tenant ON inventory.reason_codes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_reason_codes_tenant_code ON inventory.reason_codes(tenant_id, code);

-- ── Stock movements (header) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  movement_type varchar(16) NOT NULL,
  ref_doc       varchar(64),
  ref_no        varchar(64),
  posting_date  date         NOT NULL,
  from_store_id uuid,
  to_store_id   uuid,
  reason_code   varchar(32),
  notes         varchar(512),
  status        varchar(16)  NOT NULL DEFAULT 'posted',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       integer      NOT NULL DEFAULT 1,
  CONSTRAINT fk_inv_mov_from_store FOREIGN KEY (from_store_id) REFERENCES inventory.stores(id),
  CONSTRAINT fk_inv_mov_to_store   FOREIGN KEY (to_store_id)   REFERENCES inventory.stores(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_movements_tenant ON inventory.movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type   ON inventory.movements(tenant_id, movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_movements_date   ON inventory.movements(tenant_id, posting_date);

-- ── Stock movement lines ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.movement_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  movement_id  uuid NOT NULL,
  item_id      uuid NOT NULL,
  qty          integer NOT NULL,
  rate_minor   bigint  NOT NULL DEFAULT 0,
  amount_minor bigint  NOT NULL DEFAULT 0,
  currency     char(3) NOT NULL DEFAULT 'INR',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_inv_mline_movement FOREIGN KEY (movement_id) REFERENCES inventory.movements(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_mline_item     FOREIGN KEY (item_id)     REFERENCES inventory.items(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_mlines_tenant   ON inventory.movement_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_mlines_movement ON inventory.movement_lines(movement_id);
CREATE INDEX IF NOT EXISTS idx_inv_mlines_item     ON inventory.movement_lines(tenant_id, item_id);

-- ── Per-store stock balances (current state + weighted-avg cost) ────────────
CREATE TABLE IF NOT EXISTS inventory.stock_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  item_id        uuid NOT NULL,
  store_id       uuid NOT NULL,
  on_hand_qty    integer NOT NULL DEFAULT 0,
  avg_rate_minor bigint  NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'INR',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT fk_inv_bal_item  FOREIGN KEY (item_id)  REFERENCES inventory.items(id),
  CONSTRAINT fk_inv_bal_store FOREIGN KEY (store_id) REFERENCES inventory.stores(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_balances_tenant_item_store ON inventory.stock_balances(tenant_id, item_id, store_id);
CREATE INDEX IF NOT EXISTS idx_inv_balances_tenant ON inventory.stock_balances(tenant_id);

-- ── Append-only stock ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.stock_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  item_id       uuid NOT NULL,
  store_id      uuid NOT NULL,
  movement_id   uuid NOT NULL,
  movement_type varchar(16) NOT NULL,
  qty_in        integer NOT NULL DEFAULT 0,
  qty_out       integer NOT NULL DEFAULT 0,
  balance_qty   integer NOT NULL,
  rate_minor    bigint  NOT NULL DEFAULT 0,
  value_minor   bigint  NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL DEFAULT 'INR',
  reason_code   varchar(32),
  posting_date  date    NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_tenant   ON inventory.stock_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_item     ON inventory.stock_ledger(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_store    ON inventory.stock_ledger(tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_date     ON inventory.stock_ledger(tenant_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_inv_ledger_movement ON inventory.stock_ledger(movement_id);

-- ── Grants: migrations may run as civitas_admin; the service connects as
--    inventory_svc. Ensure the service role can use the new objects.
DO $$ BEGIN
  GRANT USAGE ON SCHEMA inventory TO inventory_svc;
  GRANT ALL ON ALL TABLES IN SCHEMA inventory TO inventory_svc;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA inventory TO inventory_svc;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
