-- GAP-CRM-TASK-ESCALATION-06: overdue tasks can be reassigned from the alerts
-- list. crm.activities had no owner (only created_by and a free-text
-- actor_name), so "Reassign" had nothing to write to. owner_id is the
-- identity user responsible for the task; NULL means "the creator"
-- (readers use COALESCE(owner_id, created_by)), so existing rows need no
-- backfill.
--
-- Also adds a partial index for the overdue-tasks read
-- (tenant, open tasks by due date) so the alerts list stays cheap.
--
-- Additive + idempotent: a nullable column and a guarded index.
-- Rollback:
--   DROP INDEX IF EXISTS crm.idx_activities_open_tasks_due;
--   ALTER TABLE crm.activities DROP COLUMN IF EXISTS owner_id;
-- Affected services: crm-service (activities module)
SET lock_timeout = '5s';

ALTER TABLE crm.activities
  ADD COLUMN IF NOT EXISTS owner_id uuid;

CREATE INDEX IF NOT EXISTS idx_activities_open_tasks_due
  ON crm.activities (tenant_id, due_date)
  WHERE type = 'task' AND status = 'open';
