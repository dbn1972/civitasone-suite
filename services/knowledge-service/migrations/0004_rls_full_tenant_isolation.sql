-- RLS completion: full tenant isolation (USING + WITH CHECK) for knowledge-service
-- Additive, idempotent. Safe to re-run.
-- Rollback: DROP POLICY tenant_isolation_policy on each table, then DISABLE ROW LEVEL SECURITY
--
-- AMENDED 2026-07-27 — idempotency repair, no behaviour change.
--
-- This file used bare `ALTER TABLE knowledge.categories ...` on six tables, five
-- of which no migration ever created (categories, document_shares,
-- document_versions, retention_policies, search_index — created by
-- 0011_missing_module_tables.sql). On a fresh database it therefore aborted at
-- line 12 with `relation "knowledge.categories" does not exist`, and because
-- psql runs with ON_ERROR_STOP=1 every statement after that point was skipped —
-- including the RLS policy for knowledge.documents, which DOES exist.
-- scripts/ci/bootstrap-postgres.sh logs a warning and continues, so the failure
-- was invisible and the file's own header claim of idempotency was false.
--
-- The fix applies the SAME existence-guard pattern this file already used for
-- _outbox.messages at the bottom, to all six tables. On any database where the
-- statements already succeeded the result is identical; on a fresh one, present
-- tables now get their policies instead of being skipped behind an abort.
--
-- Ordering note: 0011 creates the five missing tables and applies the identical
-- policy (same name, same USING + WITH CHECK) itself, so a fresh database ends up
-- fully isolated regardless of the order in which these two files run.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'document_shares',
    'document_versions',
    'documents',
    'retention_policies',
    'search_index'
  ]
  LOOP
    IF to_regclass(format('knowledge.%I', t)) IS NULL THEN
      RAISE NOTICE 'skipping knowledge.% — table does not exist yet (created by 0011)', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE knowledge.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE knowledge.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON knowledge.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON knowledge.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON knowledge.%I '
      'USING (tenant_id = current_tenant_id()) '
      'WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

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
