-- RLS completion: full tenant isolation (USING + WITH CHECK) for crm-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION crm.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- crm.accounts
ALTER TABLE crm.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON crm.accounts;
DROP POLICY IF EXISTS tenant_isolation ON crm.accounts;
CREATE POLICY tenant_isolation_policy ON crm.accounts
  USING (tenant_id = crm.current_tenant_id())
  WITH CHECK (tenant_id = crm.current_tenant_id());

-- crm.activities
ALTER TABLE crm.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON crm.activities;
DROP POLICY IF EXISTS tenant_isolation ON crm.activities;
CREATE POLICY tenant_isolation_policy ON crm.activities
  USING (tenant_id = crm.current_tenant_id())
  WITH CHECK (tenant_id = crm.current_tenant_id());

-- crm.contacts
ALTER TABLE crm.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON crm.contacts;
DROP POLICY IF EXISTS tenant_isolation ON crm.contacts;
CREATE POLICY tenant_isolation_policy ON crm.contacts
  USING (tenant_id = crm.current_tenant_id())
  WITH CHECK (tenant_id = crm.current_tenant_id());

-- crm.deals
ALTER TABLE crm.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.deals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON crm.deals;
DROP POLICY IF EXISTS tenant_isolation ON crm.deals;
CREATE POLICY tenant_isolation_policy ON crm.deals
  USING (tenant_id = crm.current_tenant_id())
  WITH CHECK (tenant_id = crm.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = crm.current_tenant_id())
      WITH CHECK (tenant_id = crm.current_tenant_id())';
  END IF;
END $$;
