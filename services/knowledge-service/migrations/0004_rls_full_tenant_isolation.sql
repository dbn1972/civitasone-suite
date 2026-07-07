-- RLS completion: full tenant isolation (USING + WITH CHECK) for knowledge-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- knowledge.categories
ALTER TABLE knowledge.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.categories;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.categories;
CREATE POLICY tenant_isolation_policy ON knowledge.categories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.document_shares
ALTER TABLE knowledge.document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.document_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.document_shares;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.document_shares;
CREATE POLICY tenant_isolation_policy ON knowledge.document_shares
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.document_versions
ALTER TABLE knowledge.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.document_versions;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.document_versions;
CREATE POLICY tenant_isolation_policy ON knowledge.document_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.documents
ALTER TABLE knowledge.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.documents;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.documents;
CREATE POLICY tenant_isolation_policy ON knowledge.documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.retention_policies
ALTER TABLE knowledge.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.retention_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.retention_policies;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.retention_policies;
CREATE POLICY tenant_isolation_policy ON knowledge.retention_policies
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- knowledge.search_index
ALTER TABLE knowledge.search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.search_index FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.search_index;
DROP POLICY IF EXISTS tenant_isolation ON knowledge.search_index;
CREATE POLICY tenant_isolation_policy ON knowledge.search_index
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- _outbox.messages (transactional outbox)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = '_outbox' AND table_name = 'messages') THEN
    ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON _outbox.messages';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages';
    EXECUTE 'CREATE POLICY tenant_isolation_policy ON _outbox.messages
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id())';
  END IF;
END $$;
