-- 0049_inbox_count_indexes.sql
-- UX R1 (approvals inbox), PR #2460 review should-fix 5: supporting indexes for the inbox tab
-- counts that the sidebar badge and the inbox run on every load.
--   "Done by me":  tasks WHERE tenant_id = ? AND status = completed AND completed_by = me
--                  AND updated_at >= now() - 30 days  (walked the tenant index before: 101 ms on a
--                  300k-task synthetic tenant, linear in history)
--   "Sent by me":  instances WHERE tenant_id = ? AND created_by = me AND status = active
--                  (walked every instance of the tenant before: 30 ms)
-- Both are partial indexes, so they stay small: only completed tasks / active instances.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS, outside any transaction block, exactly like
-- 0045_perf016_tenant_indexes.sql: the migration runner (scripts/ci/bootstrap-postgres.sh) applies
-- each file with a single psql -f, which opens no implicit transaction, and this file opens none.
-- Re-runnable: IF NOT EXISTS makes a second apply a no-op.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS workflow.idx_workflow_tasks_tenant_completed_by_done;
--   DROP INDEX CONCURRENTLY IF EXISTS workflow.idx_workflow_instances_tenant_created_by_active;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_tasks_tenant_completed_by_done
  ON workflow.tasks (tenant_id, completed_by, updated_at DESC)
  WHERE status = 'completed';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_instances_tenant_created_by_active
  ON workflow.instances (tenant_id, created_by)
  WHERE status = 'active';
