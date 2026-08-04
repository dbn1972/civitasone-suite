-- Purpose: AC-005 escalation state for overdue tasks. Adds escalated_at to
--   crm.next_actions and crm.activities so the task-escalation scheduler escalates
--   each overdue item to a manager exactly once (mirrors crm.contacts.escalated_at
--   from migration 0047 for lead escalation). Nullable, no backfill.
-- Rollback: ALTER TABLE crm.next_actions DROP COLUMN IF EXISTS escalated_at;
--           ALTER TABLE crm.activities   DROP COLUMN IF EXISTS escalated_at;
-- Affected services: crm-service (activities module — task escalation scheduler)

SET lock_timeout = '5s';

ALTER TABLE crm.next_actions ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE crm.activities   ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

-- Scan support: open, not-yet-escalated items ordered by when they were due.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_actions_task_escalation
  ON crm.next_actions(tenant_id, due_at)
  WHERE completed_at IS NULL AND escalated_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_task_escalation
  ON crm.activities(tenant_id, due_date)
  WHERE status = 'open' AND escalated_at IS NULL;
