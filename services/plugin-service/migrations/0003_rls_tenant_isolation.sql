-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all domain tables that carry tenant_id.
-- _outbox and _inbox are infra relay schemas consumed by a BYPASSRLS service role;
-- they are intentionally excluded from RLS.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- plugin.items
ALTER TABLE plugin.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin.items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plugin.items;
CREATE POLICY tenant_isolation ON plugin.items
  USING (tenant_id = current_tenant_id());

-- plugin.installs
ALTER TABLE plugin.installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin.installs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON plugin.installs;
CREATE POLICY tenant_isolation ON plugin.installs
  USING (tenant_id = current_tenant_id());
