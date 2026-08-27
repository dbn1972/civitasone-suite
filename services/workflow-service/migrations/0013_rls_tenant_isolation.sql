-- workflow-service RLS migration: tenant isolation backstop
-- Role: workflow_svc on civitas_workflow
-- Applied AFTER 0012_call_depth_guard.sql

-- NULL-safe from the start (current_setting(..., true), not the strict
-- one-arg-equivalent current_setting(..., false) originally here): a fresh
-- migration-replay session never sets app.tenant_id, and 0014 below seeds
-- workflow.definition_edges under this same file's newly-working FORCE RLS
-- policy — with the strict form, evaluating that policy's
-- WITH CHECK/current_tenant_id() call for 0014's INSERT raised "unrecognized
-- configuration parameter app.tenant_id" instead of the intended fail-closed
-- NULL. Matches the established repo-wide convention (see e.g. admin-service
-- 0005/0006, and this same function's own later redefinition in
-- 0018_rls_full_tenant_isolation.sql, which becomes a harmless no-op replay
-- of the identical body once applied here).
CREATE OR REPLACE FUNCTION workflow.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- definition_nodes / definition_edges are child tables of workflow.definitions
-- (linked via definition_id) and, per the application's own Drizzle model
-- (services/workflow-service/src/modules/definitions/schema.ts), deliberately
-- carry NO tenant_id column of their own — tenant scope is inherited through
-- the parent definition. Look it up via a SECURITY DEFINER function (avoids
-- policy recursion into definitions' own RLS) rather than referencing a
-- tenant_id column that does not exist on these two tables.
CREATE OR REPLACE FUNCTION workflow.definition_tenant(def_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT tenant_id FROM workflow.definitions WHERE id = def_id
$$;
REVOKE ALL ON FUNCTION workflow.definition_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow.definition_tenant(uuid) TO workflow_svc;

-- workflow schema
ALTER TABLE workflow.definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definitions;
CREATE POLICY tenant_isolation ON workflow.definitions USING (tenant_id = workflow.current_tenant_id());

ALTER TABLE workflow.definition_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_nodes;
CREATE POLICY tenant_isolation ON workflow.definition_nodes USING (workflow.definition_tenant(definition_id) = workflow.current_tenant_id());

ALTER TABLE workflow.definition_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_edges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_edges;
CREATE POLICY tenant_isolation ON workflow.definition_edges USING (workflow.definition_tenant(definition_id) = workflow.current_tenant_id());

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
