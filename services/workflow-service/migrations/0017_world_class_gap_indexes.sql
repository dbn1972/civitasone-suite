-- 0017: World-class gap analysis — performance indexes for analytics, external
-- tasks, and instance search. Additive, idempotent (IF NOT EXISTS).

-- Gap 1 (Process Mining): bottleneck and SLA compliance queries aggregate over
-- tasks by tenant + status + node_key. Cover the hot WHERE + GROUP BY path.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status_node
  ON workflow.tasks (tenant_id, status, node_key);

-- Gap 1 (Process Mining): cycle-time-by-definition joins instances on
-- definition_id and filters by status = 'completed'.
CREATE INDEX IF NOT EXISTS idx_instances_tenant_status_defid
  ON workflow.instances (tenant_id, status, definition_id);

-- Gap 5 (External Tasks): fetch-and-lock queries filter by tenant, status,
-- node_key (topic), and lock expiry. SKIP LOCKED needs an efficient scan.
CREATE INDEX IF NOT EXISTS idx_tasks_external_fetch
  ON workflow.tasks (tenant_id, status, node_key, created_at)
  WHERE status = 'pending';

-- Gap 6 (Version Analytics): version comparison groups instances by
-- definition_id, so the existing index above covers it.

-- Gap 7 (Intelligent Routing): assignment recommendations query tasks by
-- tenant, role_ref, status = 'completed', and completed_by.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_role_completed
  ON workflow.tasks (tenant_id, role_ref, status)
  WHERE status = 'completed';

-- Gap 8 (Instance Search): rich search filters on status, ref_type, ref_id,
-- definition_id, and date range.
CREATE INDEX IF NOT EXISTS idx_instances_search_reftype
  ON workflow.instances (tenant_id, status, ref_type);

CREATE INDEX IF NOT EXISTS idx_instances_created_at
  ON workflow.instances (tenant_id, created_at DESC);

-- Composite index for assignment queries (current_load subquery).
CREATE INDEX IF NOT EXISTS idx_tasks_pending_assignee
  ON workflow.tasks (tenant_id, assignee_id)
  WHERE status = 'pending';
