-- 0256_audit_hr_action_log_time_indexes.sql
--
-- UAT F100: 0135_audit_hr_action_log.sql fails on live UAT with
--   column "created_at" does not exist
-- because audit.hr_action_log already existed there in an older hand-made shape whose
-- timestamp column is occurred_at (NOT NULL DEFAULT now()). CREATE TABLE IF NOT EXISTS
-- was a silent no-op, so 0135's two time-ordered indexes were never built (its entity
-- index, RLS and policy did land). Live UAT has 123,410 rows and serves
-- tenant-scoped, newest-first listing with no (tenant_id, <time> DESC) index.
--
-- This migration achieves 0135's intent against whichever shape the table has:
--   - time column = created_at if it exists (the 0135 shape: fresh / CI), else
--     occurred_at (the live UAT shape);
--   - idx_hr_action_log_tenant_created on (tenant_id, <time> DESC) unless an index
--     with exactly that leading key already exists;
--   - idx_hr_action_log_actor on (tenant_id, actor_id, <time> DESC) unless one already
--     exists (live UAT has hr_action_log_tenant_actor_idx on exactly that key, so none
--     is added there);
--   - RLS is untouched: 0135's ENABLE/FORCE/policy did land on live UAT.
-- No data changes. The other live-shape differences (entity_id text, actor_roles
-- nullable) are left alone: the app writes both shapes correctly.
--
-- Plain CREATE INDEX (not CONCURRENTLY): it has to run inside a DO block to choose the
-- column. 123k rows index in well under a second; lock_timeout bounds the wait.
--
-- UAT effect: 1 index created (idx_hr_action_log_tenant_created on occurred_at), 0 rows
-- changed. Fresh / CI: both indexes already exist from 0135, so a no-op.
-- Idempotent: every step is guarded by a check on the real index key, not just a name.
--
-- Run as the table OWNER: on live UAT audit.hr_action_log is owned by civitas_admin,
-- not hrms_svc (it predates 0135), so the orchestrator applies this as civitas_admin.
--
-- Rollback: DROP INDEX IF EXISTS audit.idx_hr_action_log_tenant_created; (only if this
-- migration created it, i.e. on a table without created_at).

SET lock_timeout = '5s';

DO $$
DECLARE
  tbl  regclass := to_regclass('audit.hr_action_log');
  ns   text;
  tcol text;
BEGIN
  IF tbl IS NULL THEN
    RAISE EXCEPTION '0256: audit.hr_action_log does not exist (0135 has not run)';
  END IF;
  SELECT n.nspname INTO ns FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = tbl;

  SELECT attname INTO tcol
    FROM pg_attribute
   WHERE attrelid = tbl AND NOT attisdropped AND attname IN ('created_at', 'occurred_at')
   ORDER BY attname = 'created_at' DESC
   LIMIT 1;
  IF tcol IS NULL THEN
    RAISE EXCEPTION '0256: audit.hr_action_log has neither created_at nor occurred_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = tbl
       AND pg_get_indexdef(i.indexrelid) LIKE format('%%(tenant_id, %s DESC)%%', tcol)
  ) THEN
    IF to_regclass(format('%I.idx_hr_action_log_tenant_created', ns)) IS NOT NULL THEN
      RAISE EXCEPTION '0256: idx_hr_action_log_tenant_created exists with another key: %',
        pg_get_indexdef(to_regclass(format('%I.idx_hr_action_log_tenant_created', ns)));
    END IF;
    EXECUTE format('CREATE INDEX idx_hr_action_log_tenant_created ON %s (tenant_id, %I DESC)', tbl, tcol);
    RAISE NOTICE '0256: created idx_hr_action_log_tenant_created on (tenant_id, % DESC)', tcol;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = tbl
       AND pg_get_indexdef(i.indexrelid) LIKE format('%%(tenant_id, actor_id, %s DESC)%%', tcol)
  ) THEN
    IF to_regclass(format('%I.idx_hr_action_log_actor', ns)) IS NOT NULL THEN
      RAISE EXCEPTION '0256: idx_hr_action_log_actor exists with another key: %',
        pg_get_indexdef(to_regclass(format('%I.idx_hr_action_log_actor', ns)));
    END IF;
    EXECUTE format('CREATE INDEX idx_hr_action_log_actor ON %s (tenant_id, actor_id, %I DESC)', tbl, tcol);
    RAISE NOTICE '0256: created idx_hr_action_log_actor on (tenant_id, actor_id, % DESC)', tcol;
  END IF;
END $$;
