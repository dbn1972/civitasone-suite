-- stock-service initial migration
-- Applied with stock_svc role on civitas_stock.

CREATE SCHEMA IF NOT EXISTS item;
CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS entry;
CREATE SCHEMA IF NOT EXISTS valuation;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ── item module ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item.stock_item_categories (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  code             text        NOT NULL,
  item_type        varchar(16) NOT NULL DEFAULT 'consumable'
                               CHECK (item_type IN ('consumable','fixed_asset','service')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS item.stock_uoms (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  symbol           text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, symbol)
);

CREATE TABLE IF NOT EXISTS item.stock_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  code             text        NOT NULL,
  category_id      uuid        NOT NULL,
  uom_id           uuid        NOT NULL,
  item_type        varchar(16) NOT NULL DEFAULT 'consumable'
                               CHECK (item_type IN ('consumable','fixed_asset','service')),
  reorder_level    integer     NOT NULL DEFAULT 0,
  reorder_qty      integer     NOT NULL DEFAULT 0,
  valuation_method varchar(8)  NOT NULL DEFAULT 'WAVG'
                               CHECK (valuation_method IN ('WAVG','FIFO')),
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

-- ── warehouse module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouse.stock_warehouses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  name             text        NOT NULL,
  code             text        NOT NULL,
  address          text,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS warehouse.stock_locations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  warehouse_id     uuid        NOT NULL,
  name             text        NOT NULL,
  code             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, warehouse_id, code)
);

-- ── ledger module (APPEND-ONLY — no UPDATE/DELETE on this table) ──

CREATE TABLE IF NOT EXISTS ledger.stock_ledger (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  warehouse_id     uuid        NOT NULL,
  entry_id         uuid        NOT NULL,
  voucher_type     varchar(16) NOT NULL
                               CHECK (voucher_type IN ('receipt','issue','transfer_in','transfer_out','adjustment')),
  qty_in           integer     NOT NULL DEFAULT 0,
  qty_out          integer     NOT NULL DEFAULT 0,
  balance_qty      integer     NOT NULL,
  rate_minor       bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  posting_date     date        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL
  -- no updated_at/updated_by: append-only
);

CREATE INDEX IF NOT EXISTS idx_ledger_item_wh ON ledger.stock_ledger(tenant_id, item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry   ON ledger.stock_ledger(entry_id);

-- ── entry module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entry.stock_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  entry_type       varchar(16) NOT NULL
                               CHECK (entry_type IN ('receipt','issue','transfer','adjustment')),
  ref_doc          text,
  ref_no           text,
  posting_date     date        NOT NULL,
  from_warehouse_id uuid,
  to_warehouse_id  uuid,
  notes            text,
  status           varchar(16) NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','posted','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS entry.stock_entry_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  entry_id         uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  qty              integer     NOT NULL CHECK (qty > 0),
  rate_minor       bigint      NOT NULL DEFAULT 0,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_entry_items_entry ON entry.stock_entry_items(entry_id);

-- ── valuation module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS valuation.stock_valuation_rates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  warehouse_id     uuid        NOT NULL,
  qty              integer     NOT NULL DEFAULT 0,
  rate_minor       bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, item_id, warehouse_id)
);

-- ── outbox / inbox ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid         NOT NULL,
  actor_id       uuid         NOT NULL,
  correlation_id varchar(64)  NOT NULL,
  payload        jsonb        NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stock_outbox_unpublished ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
