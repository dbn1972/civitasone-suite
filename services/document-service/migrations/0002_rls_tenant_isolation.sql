-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on every document-service table that carries
-- tenant_id, following the estab-service convention (see
-- services/estab-service/migrations/0006_rls_tenant_isolation.sql):
-- current_tenant_id() reads the `app.tenant_id` session GUC that
-- @civitasone/db's createTenantDb() sets on every transaction
-- (wrapWithTenantGuc / createTenantTxHook for HTTP requests,
-- withTenantConsumer / tenantScoped for queue consumers — see
-- src/shared/db.ts, src/shared/tenant-queue.ts).
--
-- _outbox.messages / _inbox.processed are deliberately NOT given RLS here:
-- they are internal relay/idempotency tables scoped by the outbox relay and
-- consumer logic itself, not by end-user queries — the same final state
-- estab-service's own RLS history converged on (see its
-- 0039_outbox_messages_drop_rls.sql).

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- document.files
ALTER TABLE document.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.files;
CREATE POLICY tenant_isolation ON document.files
  USING (tenant_id = current_tenant_id());

-- document.file_versions
ALTER TABLE document.file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.file_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.file_versions;
CREATE POLICY tenant_isolation ON document.file_versions
  USING (tenant_id = current_tenant_id());

-- document.folders
ALTER TABLE document.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.folders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.folders;
CREATE POLICY tenant_isolation ON document.folders
  USING (tenant_id = current_tenant_id());

-- document.file_shares
ALTER TABLE document.file_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.file_shares FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.file_shares;
CREATE POLICY tenant_isolation ON document.file_shares
  USING (tenant_id = current_tenant_id());

-- document.daks
ALTER TABLE document.daks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.daks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.daks;
CREATE POLICY tenant_isolation ON document.daks
  USING (tenant_id = current_tenant_id());

-- document.notings
ALTER TABLE document.notings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.notings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.notings;
CREATE POLICY tenant_isolation ON document.notings
  USING (tenant_id = current_tenant_id());

-- document.approvals
ALTER TABLE document.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE document.approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document.approvals;
CREATE POLICY tenant_isolation ON document.approvals
  USING (tenant_id = current_tenant_id());
