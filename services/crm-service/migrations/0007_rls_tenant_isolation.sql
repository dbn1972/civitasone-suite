-- crm-service RLS migration: tenant isolation backstop
-- Role: crm_svc on civitas_crm
-- Applied AFTER 0006_contacts_status_index.sql

CREATE OR REPLACE FUNCTION crm.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- crm schema
ALTER TABLE crm.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm.contacts;
CREATE POLICY tenant_isolation ON crm.contacts USING (tenant_id = crm.current_tenant_id());

ALTER TABLE crm.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm.accounts;
CREATE POLICY tenant_isolation ON crm.accounts USING (tenant_id = crm.current_tenant_id());

ALTER TABLE crm.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.deals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm.deals;
CREATE POLICY tenant_isolation ON crm.deals USING (tenant_id = crm.current_tenant_id());

ALTER TABLE crm.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm.activities;
CREATE POLICY tenant_isolation ON crm.activities USING (tenant_id = crm.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = crm.current_tenant_id());
