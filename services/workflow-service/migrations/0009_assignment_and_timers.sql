-- 0009_assignment_and_timers.sql
-- P1-1: per-user / hierarchy assignment + claim.
-- P1-2: timer / wait nodes + deemed-approval.
-- Additive + idempotent only.

-- P1-1 — assignee_id: a task may be claimed by / assigned to a specific user.
-- NULL = unassigned (every role-holder may see + claim it).
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS assignee_id uuid;

-- index for "my tasks" lookups by assignee within a tenant.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant_assignee
  ON workflow.tasks (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;

-- P1-2 — fire_at: when a timer task should auto-advance ("deemed approved if
-- not acted within N minutes"). Only set on rows spawned at a `timer` node.
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS fire_at timestamptz;

-- sweeper lookup: pending timer tasks whose fire_at has passed.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_timer_sweep
  ON workflow.tasks (status, fire_at) WHERE fire_at IS NOT NULL;

-- P1-2 — node_type already varchar(16); 'timer' fits. timer_minutes on a node
-- defines the deemed-approval window (separate from sla_minutes which only
-- escalates). Additive.
ALTER TABLE workflow.definition_nodes ADD COLUMN IF NOT EXISTS timer_minutes integer;
