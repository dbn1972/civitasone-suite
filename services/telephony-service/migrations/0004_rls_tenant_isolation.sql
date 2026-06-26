-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all domain tables that carry tenant_id.
-- _outbox and _inbox are infra relay schemas consumed by a BYPASSRLS service role;
-- they are intentionally excluded from RLS.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- telephony.calls
ALTER TABLE telephony.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telephony.calls;
CREATE POLICY tenant_isolation ON telephony.calls
  USING (tenant_id = current_tenant_id());

-- telephony.queues
ALTER TABLE telephony.queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.queues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telephony.queues;
CREATE POLICY tenant_isolation ON telephony.queues
  USING (tenant_id = current_tenant_id());

-- telephony.agents
ALTER TABLE telephony.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telephony.agents;
CREATE POLICY tenant_isolation ON telephony.agents
  USING (tenant_id = current_tenant_id());
