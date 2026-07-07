-- RLS completeness: upgrade USING-only policies to USING + WITH CHECK
-- Purpose: Add WITH CHECK clause for INSERT enforcement on 6 workflow tables
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy ON each table; recreate with USING-only.

SET lock_timeout = '5s';

-- workflow.assignment_cursors
ALTER TABLE workflow.assignment_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.assignment_cursors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.assignment_cursors;
DROP POLICY IF EXISTS tenant_isolation ON workflow.assignment_cursors;
CREATE POLICY tenant_isolation_policy ON workflow.assignment_cursors
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.consumer_attempts
ALTER TABLE workflow.consumer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.consumer_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.consumer_attempts;
DROP POLICY IF EXISTS tenant_isolation ON workflow.consumer_attempts;
CREATE POLICY tenant_isolation_policy ON workflow.consumer_attempts
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.dead_letters
ALTER TABLE workflow.dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.dead_letters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.dead_letters;
DROP POLICY IF EXISTS tenant_isolation ON workflow.dead_letters;
CREATE POLICY tenant_isolation_policy ON workflow.dead_letters
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.definition_edges
ALTER TABLE workflow.definition_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_edges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.definition_edges;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_edges;
CREATE POLICY tenant_isolation_policy ON workflow.definition_edges
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.definition_nodes
ALTER TABLE workflow.definition_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.definition_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.definition_nodes;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_nodes;
CREATE POLICY tenant_isolation_policy ON workflow.definition_nodes
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());

-- workflow.role_members
ALTER TABLE workflow.role_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow.role_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.role_members;
DROP POLICY IF EXISTS tenant_isolation ON workflow.role_members;
CREATE POLICY tenant_isolation_policy ON workflow.role_members
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());
