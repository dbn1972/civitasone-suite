-- 0025_item_stock_links.sql
--
-- GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02 ("two item masters").
-- inventory-service (sku) and stock-service (itemCode) keep separate item masters with
-- different ids. This is a NON-DESTRUCTIVE cross-reference: one row links one inventory
-- item to one stock-service item. No id is rewritten and no master row is touched.
--
--   * at most one link per inventory item AND at most one per stock item (both directions
--     are UNIQUE per tenant), so a concurrent double link loses on the index, never silently.
--   * stock_item_code / stock_item_name are a display snapshot taken when the link is made, so
--     the register can still name the pair if stock-service is unreachable. stock-service is a
--     separate database, so stock_item_id is deliberately not a foreign key.
--   * link_source records whether an admin typed the pair (manual) or confirmed an exact
--     code/sku auto-suggestion (suggested).
--
-- Idempotent. Rollback: DROP TABLE IF EXISTS inventory.item_stock_links;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS inventory.item_stock_links (
  id                UUID PRIMARY KEY,
  tenant_id         UUID         NOT NULL,
  inventory_item_id UUID         NOT NULL REFERENCES inventory.items(id) ON DELETE RESTRICT,
  stock_item_id     UUID         NOT NULL,
  stock_item_code   VARCHAR(64)  NOT NULL,
  stock_item_name   VARCHAR(256) NOT NULL,
  link_source       VARCHAR(16)  NOT NULL DEFAULT 'manual',
  linked_by         UUID         NOT NULL,
  linked_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_item_stock_links_source CHECK (link_source IN ('manual', 'suggested'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_stock_links_inventory ON inventory.item_stock_links (tenant_id, inventory_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_stock_links_stock     ON inventory.item_stock_links (tenant_id, stock_item_id);

ALTER TABLE inventory.item_stock_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.item_stock_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON inventory.item_stock_links;
CREATE POLICY tenant_isolation ON inventory.item_stock_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$ BEGIN
  GRANT ALL ON inventory.item_stock_links TO inventory_svc;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
