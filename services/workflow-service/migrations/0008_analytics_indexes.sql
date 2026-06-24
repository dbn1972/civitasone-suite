-- P0-3 — supporting indexes for workflow analytics / SLA reporting.
-- Additive + idempotent only. These back the aggregate read endpoints
-- (/v1/workflow/analytics/summary and /bottlenecks).

-- instances-by-status + completed-instance cycle-time scans, per tenant.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant_status
  ON workflow.instances (tenant_id, status);

-- per-node dwell time + pending-per-node aggregation.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant_node_status
  ON workflow.tasks (tenant_id, node_key, status);

-- pending-by-role aggregation.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant_status_role
  ON workflow.tasks (tenant_id, status, role_ref);

-- SLA-breach scan over completed tasks with a due date.
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_tenant_status_due
  ON workflow.tasks (tenant_id, status, due_at);
