-- contract-service RLS migration: tenant isolation backstop
-- Role: contract_svc on civitas_contract
-- Applied AFTER 0002_lifecycle.sql

CREATE OR REPLACE FUNCTION contracts.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- contracts schema
ALTER TABLE contracts.contract_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_contracts;
CREATE POLICY tenant_isolation ON contracts.contract_contracts USING (tenant_id = contracts.current_tenant_id());

ALTER TABLE contracts.contract_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_milestones;
CREATE POLICY tenant_isolation ON contracts.contract_milestones USING (tenant_id = contracts.current_tenant_id());

ALTER TABLE contracts.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts.contract_amendments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contracts.contract_amendments;
CREATE POLICY tenant_isolation ON contracts.contract_amendments USING (tenant_id = contracts.current_tenant_id());

-- rate schema
ALTER TABLE rate.contract_rate_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate.contract_rate_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rate.contract_rate_contracts;
CREATE POLICY tenant_isolation ON rate.contract_rate_contracts USING (tenant_id = contracts.current_tenant_id());

ALTER TABLE rate.contract_rate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate.contract_rate_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rate.contract_rate_items;
CREATE POLICY tenant_isolation ON rate.contract_rate_items USING (tenant_id = contracts.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = contracts.current_tenant_id());
