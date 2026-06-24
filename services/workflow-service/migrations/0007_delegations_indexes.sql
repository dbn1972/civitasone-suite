-- L3 — support active-delegation lookups (delegate + tenant + active window).
-- Additive + idempotent. The workflow_delegations table itself is created in
-- migration 0004_world_class.
CREATE INDEX IF NOT EXISTS idx_workflow_delegations_delegate_active
  ON workflow.workflow_delegations (tenant_id, delegate_id, is_active);

-- Help the SLA sweeper find overdue, escalation-eligible tasks quickly.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_sla_sweep
  ON workflow.tasks (status, due_at, escalated_at);
