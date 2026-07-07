-- RLS completion: full tenant isolation (USING + WITH CHECK) for helpdesk-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION helpdesk.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- helpdesk.ticket_escalations
ALTER TABLE helpdesk.ticket_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.ticket_escalations;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.ticket_escalations;
CREATE POLICY tenant_isolation_policy ON helpdesk.ticket_escalations
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());

-- helpdesk.tickets
ALTER TABLE helpdesk.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.tickets;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.tickets;
CREATE POLICY tenant_isolation_policy ON helpdesk.tickets
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = helpdesk.current_tenant_id())
      WITH CHECK (tenant_id = helpdesk.current_tenant_id())';
  END IF;
END $$;
