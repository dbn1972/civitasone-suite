-- 0029 — background-job tenant enumeration under NOBYPASSRLS (repairs #146 regression).
--
-- Context: migration 0018 in admin-service flipped workflow_svc to NOBYPASSRLS.
-- All workflow tables carry FORCED RLS with a fail-closed policy
-- (tenant_id = workflow.current_tenant_id()), so the background sweepers and
-- the outbox relay — which legitimately operate across ALL tenants — now see
-- zero rows when no app.tenant_id GUC is set. Their per-tenant work must run
-- inside runWithTenant(tenantId, ...), but they first need a way to learn WHICH
-- tenants currently have work pending.
--
-- These SECURITY DEFINER functions (owner: the migration role, which has
-- BYPASSRLS) disclose ONLY the tenant ids that currently have candidate work —
-- no row data crosses the tenant boundary. The sweepers/relay then iterate the
-- returned tenants and do all real reads/writes inside that tenant's RLS scope.

-- Tenants with at least one pending task (SLA / reminder / timer sweeps).
CREATE OR REPLACE FUNCTION workflow.sweep_task_tenants()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM workflow.tasks WHERE status = 'pending'
$$;

-- Tenants with at least one active, timeout-bearing message subscription
-- (message-timeout sweep).
CREATE OR REPLACE FUNCTION workflow.sweep_subscription_tenants()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM workflow.message_subscriptions
  WHERE status = 'active' AND timeout_at IS NOT NULL
$$;

-- Tenants with unpublished outbox rows (transactional-outbox relay) or
-- purgeable published rows (scheduled purge).
CREATE OR REPLACE FUNCTION workflow.outbox_pending_tenants()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM _outbox.messages WHERE published_at IS NULL
$$;

CREATE OR REPLACE FUNCTION workflow.outbox_purgeable_tenants(retention interval)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM _outbox.messages
  WHERE published_at IS NOT NULL AND published_at < now() - retention
$$;

REVOKE ALL ON FUNCTION workflow.sweep_task_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow.sweep_subscription_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow.outbox_pending_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow.outbox_purgeable_tenants(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow.sweep_task_tenants() TO workflow_svc;
GRANT EXECUTE ON FUNCTION workflow.sweep_subscription_tenants() TO workflow_svc;
GRANT EXECUTE ON FUNCTION workflow.outbox_pending_tenants() TO workflow_svc;
GRANT EXECUTE ON FUNCTION workflow.outbox_purgeable_tenants(interval) TO workflow_svc;

-- Repair: definition_nodes / definition_edges carry FORCED RLS but ZERO live
-- policies — migration 0020 dropped the old policies and then tried to create
-- `tenant_id = workflow.current_tenant_id()` policies, but these child tables
-- have NO tenant_id column (they hang off workflow.definitions via
-- definition_id), so the CREATE POLICY failed and left them default-deny.
-- BYPASSRLS masked that until #146. Scope them through their parent
-- definition's tenant via a SECURITY DEFINER lookup (avoids policy recursion
-- into definitions' own RLS).
CREATE OR REPLACE FUNCTION workflow.definition_tenant(def_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = workflow, pg_temp
AS $$
  SELECT tenant_id FROM workflow.definitions WHERE id = def_id
$$;
REVOKE ALL ON FUNCTION workflow.definition_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow.definition_tenant(uuid) TO workflow_svc;

DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.definition_nodes;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_nodes;
CREATE POLICY tenant_isolation ON workflow.definition_nodes
  USING (workflow.definition_tenant(definition_id) = workflow.current_tenant_id())
  WITH CHECK (workflow.definition_tenant(definition_id) = workflow.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.definition_edges;
DROP POLICY IF EXISTS tenant_isolation ON workflow.definition_edges;
CREATE POLICY tenant_isolation ON workflow.definition_edges
  USING (workflow.definition_tenant(definition_id) = workflow.current_tenant_id())
  WITH CHECK (workflow.definition_tenant(definition_id) = workflow.current_tenant_id());

-- Consistency: designer_definitions was the one table whose policy inlined
-- current_setting('app.tenant_id', true)::uuid without NULLIF — an empty-string
-- GUC (e.g. left session-level by RLS fail-closed probes on a pooled
-- connection) makes every query on it error with `invalid input syntax for
-- type uuid: ""` instead of returning zero rows. Align it with every other
-- table's fail-closed function.
DROP POLICY IF EXISTS tenant_isolation ON workflow.designer_definitions;
DROP POLICY IF EXISTS tenant_isolation_policy ON workflow.designer_definitions;
CREATE POLICY tenant_isolation ON workflow.designer_definitions
  USING (tenant_id = workflow.current_tenant_id())
  WITH CHECK (tenant_id = workflow.current_tenant_id());
