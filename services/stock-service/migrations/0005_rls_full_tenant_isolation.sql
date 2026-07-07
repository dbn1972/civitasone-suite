-- RLS completion: full tenant isolation (USING + WITH CHECK) for stock-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION item.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- entry.stock_entries
ALTER TABLE entry.stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON entry.stock_entries;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_entries;
CREATE POLICY tenant_isolation_policy ON entry.stock_entries
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- entry.stock_entry_items
ALTER TABLE entry.stock_entry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_entry_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON entry.stock_entry_items;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_entry_items;
CREATE POLICY tenant_isolation_policy ON entry.stock_entry_items
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- entry.stock_receipts
ALTER TABLE entry.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry.stock_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON entry.stock_receipts;
DROP POLICY IF EXISTS tenant_isolation ON entry.stock_receipts;
CREATE POLICY tenant_isolation_policy ON entry.stock_receipts
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- eway_bill.eway_bills
ALTER TABLE eway_bill.eway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE eway_bill.eway_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON eway_bill.eway_bills;
DROP POLICY IF EXISTS tenant_isolation ON eway_bill.eway_bills;
CREATE POLICY tenant_isolation_policy ON eway_bill.eway_bills
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- item.stock_item_categories
ALTER TABLE item.stock_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_item_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON item.stock_item_categories;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_item_categories;
CREATE POLICY tenant_isolation_policy ON item.stock_item_categories
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- item.stock_items
ALTER TABLE item.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON item.stock_items;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_items;
CREATE POLICY tenant_isolation_policy ON item.stock_items
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- item.stock_uoms
ALTER TABLE item.stock_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE item.stock_uoms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON item.stock_uoms;
DROP POLICY IF EXISTS tenant_isolation ON item.stock_uoms;
CREATE POLICY tenant_isolation_policy ON item.stock_uoms
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- ledger.stock_ledger
ALTER TABLE ledger.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.stock_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON ledger.stock_ledger;
DROP POLICY IF EXISTS tenant_isolation ON ledger.stock_ledger;
CREATE POLICY tenant_isolation_policy ON ledger.stock_ledger
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- valuation.stock_valuation_rates
ALTER TABLE valuation.stock_valuation_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE valuation.stock_valuation_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON valuation.stock_valuation_rates;
DROP POLICY IF EXISTS tenant_isolation ON valuation.stock_valuation_rates;
CREATE POLICY tenant_isolation_policy ON valuation.stock_valuation_rates
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- warehouse.stock_locations
ALTER TABLE warehouse.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON warehouse.stock_locations;
DROP POLICY IF EXISTS tenant_isolation ON warehouse.stock_locations;
CREATE POLICY tenant_isolation_policy ON warehouse.stock_locations
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- warehouse.stock_warehouses
ALTER TABLE warehouse.stock_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.stock_warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON warehouse.stock_warehouses;
DROP POLICY IF EXISTS tenant_isolation ON warehouse.stock_warehouses;
CREATE POLICY tenant_isolation_policy ON warehouse.stock_warehouses
  USING (tenant_id = item.current_tenant_id())
  WITH CHECK (tenant_id = item.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = item.current_tenant_id())
      WITH CHECK (tenant_id = item.current_tenant_id())';
  END IF;
END $$;
