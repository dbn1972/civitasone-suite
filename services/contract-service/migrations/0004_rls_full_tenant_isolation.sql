-- RLS completion: full tenant isolation (USING + WITH CHECK) for contract-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION contracts.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- contracts.contract_amendments
ALTER TABLE contracts.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_amendments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON contracts.contract_amendments;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_amendments;
CREATE POLICY tenant_isolation_policy ON contracts.contract_amendments
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

-- contracts.contract_contracts
ALTER TABLE contracts.contract_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON contracts.contract_contracts;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_contracts;
CREATE POLICY tenant_isolation_policy ON contracts.contract_contracts
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

-- contracts.contract_milestones
ALTER TABLE contracts.contract_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON contracts.contract_milestones;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_milestones;
CREATE POLICY tenant_isolation_policy ON contracts.contract_milestones
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

-- rate.contract_rate_contracts
ALTER TABLE rate.contract_rate_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate.contract_rate_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rate.contract_rate_contracts;
DROP POLICY IF EXISTS tenant_isolation ON rate.contract_rate_contracts;
CREATE POLICY tenant_isolation_policy ON rate.contract_rate_contracts
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

-- rate.contract_rate_items
ALTER TABLE rate.contract_rate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate.contract_rate_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rate.contract_rate_items;
DROP POLICY IF EXISTS tenant_isolation ON rate.contract_rate_items;
CREATE POLICY tenant_isolation_policy ON rate.contract_rate_items
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = contracts.current_tenant_id())
      WITH CHECK (tenant_id = contracts.current_tenant_id())';
  END IF;
END $$;
