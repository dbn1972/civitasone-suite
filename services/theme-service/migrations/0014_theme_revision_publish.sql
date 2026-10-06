-- 0014_theme_revision_publish.sql
-- GAP-THEMES-HOME-01 / GAP-THEMES-TOKENS-02: support an audited, role-gated
-- theme-publish action. theme.revisions already exists (0002) with RLS (0003);
-- this file is additive and idempotent:
--   1. adds a nullable `reason` column so the publish reason is persisted with
--      the revision (the audit event also records it);
--   2. upgrades the revisions RLS policy to include WITH CHECK (0003 set only
--      USING, so INSERTs relied on the USING-as-check default) — matches the
--      explicit USING+WITH CHECK pattern 0005 applied to the other tables.
-- Rollback:
--   ALTER TABLE theme.revisions DROP COLUMN IF EXISTS reason;
--   DROP POLICY IF EXISTS tenant_isolation_policy ON theme.revisions;
--   (0003's `tenant_isolation` USING-only policy would then need recreating.)

SET lock_timeout = '5s';

ALTER TABLE theme.revisions ADD COLUMN IF NOT EXISTS reason text;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE theme.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme.revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON theme.revisions;
DROP POLICY IF EXISTS tenant_isolation_policy ON theme.revisions;
CREATE POLICY tenant_isolation_policy ON theme.revisions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
