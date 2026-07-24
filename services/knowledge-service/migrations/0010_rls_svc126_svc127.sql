-- RLS full tenant isolation for SVC-126 / SVC-127 tables (mirrors 0004_rls_full_tenant_isolation.sql).
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- knowledge.policy_documents
ALTER TABLE knowledge.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.policy_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.policy_documents;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.policy_documents;
CREATE POLICY tenant_isolation_policy ON knowledge.policy_documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.policy_acknowledgements
ALTER TABLE knowledge.policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.policy_acknowledgements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.policy_acknowledgements;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.policy_acknowledgements;
CREATE POLICY tenant_isolation_policy ON knowledge.policy_acknowledgements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.faqs
ALTER TABLE knowledge.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.faqs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.faqs;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.faqs;
CREATE POLICY tenant_isolation_policy ON knowledge.faqs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.guided_flows
ALTER TABLE knowledge.guided_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.guided_flows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.guided_flows;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.guided_flows;
CREATE POLICY tenant_isolation_policy ON knowledge.guided_flows
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.assistant_interactions
ALTER TABLE knowledge.assistant_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.assistant_interactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.assistant_interactions;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.assistant_interactions;
CREATE POLICY tenant_isolation_policy ON knowledge.assistant_interactions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
