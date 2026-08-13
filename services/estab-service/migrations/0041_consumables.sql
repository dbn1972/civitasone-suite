-- Migration: 0041_consumables.sql
-- Purpose: Consumables inventory tracking — stationery, office supplies, materials.
-- Rollback: DROP SCHEMA consumables CASCADE;
-- Affected services: estab-service (consumables module)

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS consumables;
GRANT USAGE ON SCHEMA consumables TO estab_svc;

CREATE TABLE IF NOT EXISTS consumables.items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          text NOT NULL,
  category      varchar(64) NOT NULL DEFAULT 'stationery',
  unit          varchar(32) NOT NULL DEFAULT 'piece',
  stock_qty     numeric(12, 2) NOT NULL DEFAULT 0,
  reorder_level numeric(12, 2) NOT NULL DEFAULT 0,
  status        varchar(24) NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_consumable_status CHECK (status IN ('active', 'inactive', 'discontinued')),
  CONSTRAINT chk_stock_qty_nonneg CHECK (stock_qty >= 0)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consumables_items_tenant
  ON consumables.items (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consumables_items_category
  ON consumables.items (tenant_id, category);

CREATE TABLE IF NOT EXISTS consumables.transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  item_id     uuid NOT NULL REFERENCES consumables.items(id),
  txn_type    varchar(16) NOT NULL,
  qty         numeric(12, 2) NOT NULL,
  ref_doc     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  CONSTRAINT chk_consumable_txn_type CHECK (txn_type IN ('receipt', 'issue', 'adjustment', 'return')),
  CONSTRAINT chk_txn_qty_nonzero CHECK (qty != 0)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consumables_txns_tenant_item
  ON consumables.transactions (tenant_id, item_id);

ALTER TABLE consumables.items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_consumable_items ON consumables.items
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rls_consumable_txns ON consumables.transactions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON consumables.items TO estab_svc;
GRANT SELECT, INSERT ON consumables.transactions TO estab_svc;
