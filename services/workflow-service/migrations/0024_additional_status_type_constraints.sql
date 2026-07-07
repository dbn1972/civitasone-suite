-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: workflow-service

SET lock_timeout = '5s';

-- ============================================================================
-- workflow.instances.ref_type
-- Valid values: leave_app, payroll_run, procurement_indent, procurement_po,
-- estab_file, asset_disposal
-- (source: this service's own src/topics.ts DISPATCH map and
-- modules/tasks/consumer.ts dispatchDomainApprove()'s REF_PERMISSION-style
-- lookup table define the complete, fixed list of trigger types a workflow
-- instance is ever created for. Confirmed by grepping every cross-service
-- producer of the workflow.instance.create command in this monorepo:
-- hrms-service/src/modules/leave/consumer.ts ("leave_app"),
-- procurement-service/src/modules/indent/consumer.ts ("procurement_indent"),
-- procurement-service/src/modules/po/consumer.ts ("procurement_po"),
-- estab-service/src/modules/files/consumer.ts and
-- estab-service/src/modules/linkage/consumer.ts ("estab_file"),
-- asset-service/src/modules/enterprise/routes.ts ("asset_disposal").
-- "payroll_run" has no active producer yet but is already wired into this
-- service's own DISPATCH/dispatchDomainApprove map, so it is retained as a
-- valid, reserved trigger type. ref_type is nullable (not every instance is
-- tied to a domain trigger), so NULL is not restricted by this constraint.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.instances
    ADD CONSTRAINT instances_ref_type_check
    CHECK (ref_type IS NULL OR ref_type IN ('leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.tasks.ref_type
-- Valid values: leave_app, payroll_run, procurement_indent, procurement_po,
-- estab_file, asset_disposal
-- (task.ref_type is always copied from its parent instance's ref_type — see
-- modules/tasks/repo.ts / modules/instances/repo.ts and every task-view
-- projection in modules/tasks/consumer.ts that sets `refType: instance.refType`
-- — so it shares the exact same closed set as workflow.instances.ref_type
-- above. Nullable for the same reason.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.tasks
    ADD CONSTRAINT tasks_ref_type_check
    CHECK (ref_type IS NULL OR ref_type IN ('leave_app', 'payroll_run', 'procurement_indent', 'procurement_po', 'estab_file', 'asset_disposal'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- workflow.definition_nodes.node_type
-- Valid values: task, split, parallel, join, start, end, timer, xor,
-- exclusive, call, message_catch, message_throw, signal_catch, decision
-- (source: modules/definitions/graph.ts KNOWN_NODE_TYPES — the authoritative,
-- enforced set used by validateGraph() at definition create/deploy time.
-- Any node_type not in this set is rejected there with "unknown node_type",
-- so this is the engine's own closed vocabulary, not a guess.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workflow.definition_nodes
    ADD CONSTRAINT definition_nodes_node_type_check
    CHECK (node_type IN ('task', 'split', 'parallel', 'join', 'start', 'end', 'timer', 'xor', 'exclusive', 'call', 'message_catch', 'message_throw', 'signal_catch', 'decision'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE workflow.instances VALIDATE CONSTRAINT instances_ref_type_check;
ALTER TABLE workflow.tasks VALIDATE CONSTRAINT tasks_ref_type_check;
ALTER TABLE workflow.definition_nodes VALIDATE CONSTRAINT definition_nodes_node_type_check;
