-- RLS completion: full tenant isolation (USING + WITH CHECK) for workflow-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION workflow.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- workflow.decision_tables
ALTER TABLE workflow.decision_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.decision_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.decision_tables;
DROP POLICY IF EXISTS tenant_isolation ON workflow.decision_tables;
CREATE POLICY tenant_isolation_policy ON workflow.decision_tables
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.definitions
ALTER TABLE workflow.definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.definitions;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definitions;
CREATE POLICY tenant_isolation_policy ON workflow.definitions
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.instances
ALTER TABLE workflow.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.instances;
DROP POLICY IF EXISTS tenant_isolation ON workflow.instances;
CREATE POLICY tenant_isolation_policy ON workflow.instances
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.message_subscriptions
ALTER TABLE workflow.message_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.message_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.message_subscriptions;
DROP POLICY IF EXISTS tenant_isolation ON workflow.message_subscriptions;
CREATE POLICY tenant_isolation_policy ON workflow.message_subscriptions
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.responsibility_matrix
ALTER TABLE workflow.responsibility_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.responsibility_matrix FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.responsibility_matrix;
DROP POLICY IF EXISTS tenant_isolation ON workflow.responsibility_matrix;
CREATE POLICY tenant_isolation_policy ON workflow.responsibility_matrix
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.signal_subscriptions
ALTER TABLE workflow.signal_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.signal_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.signal_subscriptions;
DROP POLICY IF EXISTS tenant_isolation ON workflow.signal_subscriptions;
CREATE POLICY tenant_isolation_policy ON workflow.signal_subscriptions
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.substitution_rules
ALTER TABLE workflow.substitution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.substitution_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.substitution_rules;
DROP POLICY IF EXISTS tenant_isolation ON workflow.substitution_rules;
CREATE POLICY tenant_isolation_policy ON workflow.substitution_rules
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.task_forwards
ALTER TABLE workflow.task_forwards ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.task_forwards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.task_forwards;
DROP POLICY IF EXISTS tenant_isolation ON workflow.task_forwards;
CREATE POLICY tenant_isolation_policy ON workflow.task_forwards
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.tasks
ALTER TABLE workflow.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.tasks;
DROP POLICY IF EXISTS tenant_isolation ON workflow.tasks;
CREATE POLICY tenant_isolation_policy ON workflow.tasks
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.transition_history
ALTER TABLE workflow.transition_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.transition_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.transition_history;
DROP POLICY IF EXISTS tenant_isolation ON workflow.transition_history;
CREATE POLICY tenant_isolation_policy ON workflow.transition_history
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.workflow_delegations
ALTER TABLE workflow.workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.workflow_delegations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.workflow_delegations;
DROP POLICY IF EXISTS tenant_isolation ON workflow.workflow_delegations;
CREATE POLICY tenant_isolation_policy ON workflow.workflow_delegations
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = workflow.current_tenant_id())
      WITH CHECK (tenant_id = workflow.current_tenant_id())';
  END IF;
END $$;
