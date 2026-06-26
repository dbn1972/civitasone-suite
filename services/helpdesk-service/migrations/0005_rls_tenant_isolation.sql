-- helpdesk-service RLS migration: tenant isolation backstop
-- Role: helpdesk_svc on civitas_helpdesk
-- Applied AFTER 0004_sla_breach_linkage.sql

CREATE OR REPLACE FUNCTION helpdesk.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- helpdesk schema
ALTER TABLE helpdesk.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.tickets;
CREATE POLICY tenant_isolation ON helpdesk.tickets USING (tenant_id = helpdesk.current_tenant_id());

ALTER TABLE helpdesk.ticket_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.ticket_escalations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON helpdesk.ticket_escalations;
CREATE POLICY tenant_isolation ON helpdesk.ticket_escalations USING (tenant_id = helpdesk.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = helpdesk.current_tenant_id());
