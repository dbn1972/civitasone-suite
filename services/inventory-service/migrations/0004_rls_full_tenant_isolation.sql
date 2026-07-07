-- RLS completion: full tenant isolation (USING + WITH CHECK) for inventory-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- inventory.categories
ALTER TABLE inventory.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.categories;
DROP POLICY IF EXISTS tenant_isolation ON inventory.categories;
CREATE POLICY tenant_isolation_policy ON inventory.categories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.items
ALTER TABLE inventory.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.items;
DROP POLICY IF EXISTS tenant_isolation ON inventory.items;
CREATE POLICY tenant_isolation_policy ON inventory.items
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.movement_lines
ALTER TABLE inventory.movement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.movement_lines;
DROP POLICY IF EXISTS tenant_isolation ON inventory.movement_lines;
CREATE POLICY tenant_isolation_policy ON inventory.movement_lines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.movements
ALTER TABLE inventory.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.movements;
DROP POLICY IF EXISTS tenant_isolation ON inventory.movements;
CREATE POLICY tenant_isolation_policy ON inventory.movements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.reason_codes
ALTER TABLE inventory.reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reason_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.reason_codes;
DROP POLICY IF EXISTS tenant_isolation ON inventory.reason_codes;
CREATE POLICY tenant_isolation_policy ON inventory.reason_codes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.stock_balances
ALTER TABLE inventory.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_balances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.stock_balances;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stock_balances;
CREATE POLICY tenant_isolation_policy ON inventory.stock_balances
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.stock_ledger
ALTER TABLE inventory.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.stock_ledger;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stock_ledger;
CREATE POLICY tenant_isolation_policy ON inventory.stock_ledger
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.stores
ALTER TABLE inventory.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.stores;
DROP POLICY IF EXISTS tenant_isolation ON inventory.stores;
CREATE POLICY tenant_isolation_policy ON inventory.stores
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- inventory.uoms
ALTER TABLE inventory.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.uoms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON inventory.uoms;
DROP POLICY IF EXISTS tenant_isolation ON inventory.uoms;
CREATE POLICY tenant_isolation_policy ON inventory.uoms
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
