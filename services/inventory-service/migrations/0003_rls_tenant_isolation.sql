-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all inventory-service tables that carry tenant_id.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- inventory.items
ALTER TABLE inventory.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.items;
CREATE POLICY tenant_isolation ON inventory.items
  USING (tenant_id = current_tenant_id());

-- inventory.categories
ALTER TABLE inventory.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.categories;
CREATE POLICY tenant_isolation ON inventory.categories
  USING (tenant_id = current_tenant_id());

-- inventory.uoms
ALTER TABLE inventory.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.uoms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.uoms;
CREATE POLICY tenant_isolation ON inventory.uoms
  USING (tenant_id = current_tenant_id());

-- inventory.stores
ALTER TABLE inventory.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stores;
CREATE POLICY tenant_isolation ON inventory.stores
  USING (tenant_id = current_tenant_id());

-- inventory.reason_codes
ALTER TABLE inventory.reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reason_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.reason_codes;
CREATE POLICY tenant_isolation ON inventory.reason_codes
  USING (tenant_id = current_tenant_id());

-- inventory.movements
ALTER TABLE inventory.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.movements;
CREATE POLICY tenant_isolation ON inventory.movements
  USING (tenant_id = current_tenant_id());

-- inventory.movement_lines
ALTER TABLE inventory.movement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.movement_lines;
CREATE POLICY tenant_isolation ON inventory.movement_lines
  USING (tenant_id = current_tenant_id());

-- inventory.stock_balances
ALTER TABLE inventory.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stock_balances;
CREATE POLICY tenant_isolation ON inventory.stock_balances
  USING (tenant_id = current_tenant_id());

-- inventory.stock_ledger
ALTER TABLE inventory.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stock_ledger;
CREATE POLICY tenant_isolation ON inventory.stock_ledger
  USING (tenant_id = current_tenant_id());

-- _outbox.messages
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id());
