-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: workflow-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- workflow.responsibility_matrix.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_responsibility_matrix_user_id
  ON workflow.responsibility_matrix (user_id);

-- workflow.substitution_rules.user_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_substitution_rules_user_id
  ON workflow.substitution_rules (user_id);

-- workflow.substitution_rules.substitute_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_substitution_rules_substitute_id
  ON workflow.substitution_rules (substitute_id);

-- workflow.definition_nodes.definition_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_definition_nodes_definition_id
  ON workflow.definition_nodes (definition_id);

-- workflow.workflow_delegations.delegator_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_delegations_delegator_id
  ON workflow.workflow_delegations (delegator_id);

-- workflow.workflow_delegations.delegate_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_delegations_delegate_id
  ON workflow.workflow_delegations (delegate_id);

-- workflow.transition_history.task_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transition_history_task_id
  ON workflow.transition_history (task_id);

-- workflow.transition_history.actor_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transition_history_actor_id
  ON workflow.transition_history (actor_id);

-- workflow.instances.definition_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instances_definition_id
  ON workflow.instances (definition_id);

-- workflow.instances.ref_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instances_ref_id
  ON workflow.instances (ref_id);

-- workflow.instances.parent_task_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instances_parent_task_id
  ON workflow.instances (parent_task_id);

-- workflow.message_subscriptions.task_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_subscriptions_task_id
  ON workflow.message_subscriptions (task_id);

-- workflow.signal_subscriptions.task_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_subscriptions_task_id
  ON workflow.signal_subscriptions (task_id);

-- workflow.tasks.ref_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_ref_id
  ON workflow.tasks (ref_id);

-- workflow.tasks.assignee_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assignee_id
  ON workflow.tasks (assignee_id);
