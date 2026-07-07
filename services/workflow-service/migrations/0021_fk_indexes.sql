-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: workflow-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Note: workflow.tasks.instance_id already has idx_tasks_instance — audited and confirmed.

SET lock_timeout = '5s';

-- workflow.tasks.created_by (FK to user — used for "my tasks" lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_created_by
  ON workflow.tasks (created_by);

-- workflow.tasks.updated_by (FK to user — used for task reassignment queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_updated_by
  ON workflow.tasks (updated_by);
