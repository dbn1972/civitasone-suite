-- workflow-service RLS migration: tenant isolation backstop
-- Role: workflow_svc on civitas_workflow
-- Applied AFTER 0012_call_depth_guard.sql

CREATE OR REPLACE FUNCTION workflow.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT current_setting('app.tenant_id', false)::uuid
$$;

-- workflow schema
ALTER TABLE workflow.definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definitions;
CREATE POLICY tenant_isolation ON workflow.definitions USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.definition_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_nodes;
CREATE POLICY tenant_isolation ON workflow.definition_nodes USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.definition_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_edges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_edges;
CREATE POLICY tenant_isolation ON workflow.definition_edges USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.instances;
CREATE POLICY tenant_isolation ON workflow.instances USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.tasks;
CREATE POLICY tenant_isolation ON workflow.tasks USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.workflow_delegations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.workflow_delegations;
CREATE POLICY tenant_isolation ON workflow.workflow_delegations USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.transition_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.transition_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.transition_history;
CREATE POLICY tenant_isolation ON workflow.transition_history USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.consumer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.consumer_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.consumer_attempts;
CREATE POLICY tenant_isolation ON workflow.consumer_attempts USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.dead_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.dead_letters;
CREATE POLICY tenant_isolation ON workflow.dead_letters USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.role_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.role_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.role_members;
CREATE POLICY tenant_isolation ON workflow.role_members USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.assignment_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.assignment_cursors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.assignment_cursors;
CREATE POLICY tenant_isolation ON workflow.assignment_cursors USING (tenant_id = workflow.current_tenant_id());

-- outbox
ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages USING (tenant_id = workflow.current_tenant_id());
