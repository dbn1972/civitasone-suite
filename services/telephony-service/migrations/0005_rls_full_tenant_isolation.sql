-- RLS completion: full tenant isolation (USING + WITH CHECK) for telephony-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- telephony.agents
ALTER TABLE telephony.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON telephony.agents;
DROP POLICY IF EXISTS tenant_isolation ON telephony.agents;
CREATE POLICY tenant_isolation_policy ON telephony.agents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- telephony.calls
ALTER TABLE telephony.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON telephony.calls;
DROP POLICY IF EXISTS tenant_isolation ON telephony.calls;
CREATE POLICY tenant_isolation_policy ON telephony.calls
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- telephony.queues
ALTER TABLE telephony.queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.queues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON telephony.queues;
DROP POLICY IF EXISTS tenant_isolation ON telephony.queues;
CREATE POLICY tenant_isolation_policy ON telephony.queues
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
