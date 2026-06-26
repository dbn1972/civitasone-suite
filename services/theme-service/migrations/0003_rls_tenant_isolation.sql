-- Additive, idempotent. Safe to re-run.
-- Enables Row Level Security on all domain tables that carry tenant_id.
-- _outbox and _inbox are infra relay schemas consumed by a BYPASSRLS service role;
-- they are intentionally excluded from RLS.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- theme.tokens
ALTER TABLE theme.tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON theme.tokens;
CREATE POLICY tenant_isolation ON theme.tokens
  USING (tenant_id = current_tenant_id());

-- theme.revisions
ALTER TABLE theme.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON theme.revisions;
CREATE POLICY tenant_isolation ON theme.revisions
  USING (tenant_id = current_tenant_id());
