-- install-service RLS migration: tenant isolation backstop
-- Role: install_svc on civitas_install
-- Applied AFTER 0002_install_execution.sql
-- Tables covered: install.stages, _outbox.messages
-- Skipped: _inbox.processed (no tenant_id column — consumer idempotency log)

CREATE OR REPLACE FUNCTION install.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- install.stages — per-tenant installation step tracking
ALTER TABLE install.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE install.stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON install.stages;
CREATE POLICY tenant_isolation ON install.stages
  USING (tenant_id = install.current_tenant_id());

-- _outbox.messages — transactional outbox; tenant_id present on every row
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = install.current_tenant_id());
