-- RLS completion: full tenant isolation (USING + WITH CHECK) for install-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION install.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- install.silo_provisions
ALTER TABLE install.silo_provisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE install.silo_provisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON install.silo_provisions;
DROP POLICY IF EXISTS tenant_isolation ON install.silo_provisions;
CREATE POLICY tenant_isolation_policy ON install.silo_provisions
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());

-- install.stages
ALTER TABLE install.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE install.stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON install.stages;
DROP POLICY IF EXISTS tenant_isolation ON install.stages;
CREATE POLICY tenant_isolation_policy ON install.stages
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());

-- orchestrator.step_definitions
ALTER TABLE orchestrator.step_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator.step_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON orchestrator.step_definitions;
DROP POLICY IF EXISTS tenant_isolation ON orchestrator.step_definitions;
CREATE POLICY tenant_isolation_policy ON orchestrator.step_definitions
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());

-- orchestrator.step_executions
ALTER TABLE orchestrator.step_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator.step_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON orchestrator.step_executions;
DROP POLICY IF EXISTS tenant_isolation ON orchestrator.step_executions;
CREATE POLICY tenant_isolation_policy ON orchestrator.step_executions
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());

-- orchestrator.wizard_definitions
ALTER TABLE orchestrator.wizard_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator.wizard_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON orchestrator.wizard_definitions;
DROP POLICY IF EXISTS tenant_isolation ON orchestrator.wizard_definitions;
CREATE POLICY tenant_isolation_policy ON orchestrator.wizard_definitions
  USING (tenant_id = install.current_tenant_id())
  WITH CHECK (tenant_id = install.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = install.current_tenant_id())
      WITH CHECK (tenant_id = install.current_tenant_id())';
  END IF;
END $$;
