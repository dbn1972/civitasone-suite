-- stock-service RLS migration: tenant isolation backstop
-- Role: stock_svc on civitas_stock
-- Applied AFTER 0002_fifo_receipts.sql

CREATE OR REPLACE FUNCTION item.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- item schema
ALTER TABLE item.stock_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_item_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_item_categories;
CREATE POLICY tenant_isolation ON item.stock_item_categories USING (tenant_id = item.current_tenant_id());

ALTER TABLE item.stock_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_uoms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_uoms;
CREATE POLICY tenant_isolation ON item.stock_uoms USING (tenant_id = item.current_tenant_id());

ALTER TABLE item.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_items;
CREATE POLICY tenant_isolation ON item.stock_items USING (tenant_id = item.current_tenant_id());

-- warehouse schema
ALTER TABLE warehouse.stock_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warehouse.stock_warehouses;
CREATE POLICY tenant_isolation ON warehouse.stock_warehouses USING (tenant_id = item.current_tenant_id());

ALTER TABLE warehouse.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON warehouse.stock_locations;
CREATE POLICY tenant_isolation ON warehouse.stock_locations USING (tenant_id = item.current_tenant_id());

-- ledger schema
ALTER TABLE ledger.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.stock_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger.stock_ledger;
CREATE POLICY tenant_isolation ON ledger.stock_ledger USING (tenant_id = item.current_tenant_id());

-- entry schema
ALTER TABLE entry.stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_entries;
CREATE POLICY tenant_isolation ON entry.stock_entries USING (tenant_id = item.current_tenant_id());

ALTER TABLE entry.stock_entry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_entry_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_entry_items;
CREATE POLICY tenant_isolation ON entry.stock_entry_items USING (tenant_id = item.current_tenant_id());

ALTER TABLE entry.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_receipts;
CREATE POLICY tenant_isolation ON entry.stock_receipts USING (tenant_id = item.current_tenant_id());

-- valuation schema
ALTER TABLE valuation.stock_valuation_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation.stock_valuation_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON valuation.stock_valuation_rates;
CREATE POLICY tenant_isolation ON valuation.stock_valuation_rates USING (tenant_id = item.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = item.current_tenant_id());
