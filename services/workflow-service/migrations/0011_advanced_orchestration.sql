-- 0011_advanced_orchestration.sql
-- Advanced orchestration gaps (build ON TOP of existing hardening):
--   1. Sub-workflow / call-activity (parent waits for child, propagation).
--   2. Richer edge-condition language (AND/OR/NOT/parens) — no schema change.
--   3. DLQ / max-retry for poison consumer messages (+ admin requeue).
--   4. Hierarchy / round-robin assignment strategy on a node.
--   5. Pre-breach reminders (distinct from escalation_count).
--   6. Audit export — no schema change (reads transition_history).
--   7. Definition templates (is_template + clone-into-tenant).
-- Additive + idempotent only.

-- ---------------------------------------------------------------------------
-- 1. Sub-workflow / call-activity.
-- A node of node_type='call' spawns a CHILD instance of another active
-- definition (call_definition_code) on entry, and the parent instance pauses
-- at this node until the child reaches a terminal state. We track the parent
-- linkage on the child instance so the child's terminal completion can resume
-- the parent's waiting task.
-- ---------------------------------------------------------------------------

-- The definition code a `call` node instantiates as a child.
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS call_definition_code varchar(64);

-- Optional JSON mapping of parent-context paths -> child-context keys. NULL =>
-- pass the parent context through unchanged.
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS call_context_map jsonb;

-- Child->parent linkage. When a call node spawns a child, we record the parent
-- instance id, the parent's waiting task id (the call task), and the parent
-- node key, on the CHILD instance row. On the child reaching a terminal state
-- the engine resumes the parent by completing that waiting call-task.
ALTER TABLE workflow.instances
  ADD COLUMN IF NOT EXISTS parent_instance_id uuid;
ALTER TABLE workflow.instances
  ADD COLUMN IF NOT EXISTS parent_task_id uuid;
ALTER TABLE workflow.instances
  ADD COLUMN IF NOT EXISTS parent_node_key varchar(64);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_parent
  ON workflow.instances (parent_instance_id) WHERE parent_instance_id IS NOT NULL;

-- A call-task is a non-human "wait" task held at the call node until the child
-- finishes. We mark it with the child instance id so we never auto-complete it
-- by a human and so we can correlate the child terminal -> parent resume.
ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS child_instance_id uuid;
ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS is_call boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_child_instance
  ON workflow.tasks (child_instance_id) WHERE child_instance_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. DLQ — consumer-side dead-letter table for poison messages.
-- A message that fails N (max_attempts) processing attempts is recorded here
-- (with payload + last error) instead of looping forever; an admin can list and
-- requeue. attempt tracking is in workflow.consumer_attempts.
-- ---------------------------------------------------------------------------

-- Per (topic,message_id) attempt counter, so a deterministically-failing
-- command can be detected and dead-lettered after max_attempts.
CREATE TABLE IF NOT EXISTS workflow.consumer_attempts (
  topic         varchar(128) NOT NULL,
  message_id    uuid         NOT NULL,
  tenant_id     uuid         NOT NULL,
  attempt_count integer      NOT NULL DEFAULT 0,
  last_error    text,
  first_seen_at timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (topic, message_id)
);

CREATE TABLE IF NOT EXISTS workflow.dead_letters (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL,
  topic         varchar(128) NOT NULL,
  message_id    uuid         NOT NULL,
  envelope      jsonb        NOT NULL,
  error         text         NOT NULL,
  attempt_count integer      NOT NULL DEFAULT 0,
  status        varchar(24)  NOT NULL DEFAULT 'dead',  -- dead | requeued
  created_at    timestamptz  NOT NULL DEFAULT now(),
  requeued_at   timestamptz,
  requeued_by   uuid
);

CREATE INDEX IF NOT EXISTS idx_workflow_dead_letters_tenant
  ON workflow.dead_letters (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_dead_letters_msg
  ON workflow.dead_letters (topic, message_id);

-- ---------------------------------------------------------------------------
-- 4. Assignment strategy on a node. NULL/'none' => legacy (role-pool, anyone
-- may claim). 'round_robin' | 'least_loaded' | 'hierarchy'.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS assign_strategy varchar(24);

-- For 'hierarchy': the node may pin a reference user whose reporting line we
-- resolve against (e.g. "the role-holder reporting to X"). For round-robin /
-- least-loaded the candidate pool is the set of role-holders.
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS assign_ref varchar(128);

-- Candidate role-holders for assignment (round-robin / least-loaded / hierarchy
-- resolution). workflow-service has no user directory of its own, so a tenant
-- registers role memberships + an optional reporting line here. Additive and
-- self-contained; populated by admin (or synced from identity) out of band.
CREATE TABLE IF NOT EXISTS workflow.role_members (
  tenant_id   uuid         NOT NULL,
  role_ref    varchar(128) NOT NULL,
  user_id     uuid         NOT NULL,
  reports_to  uuid,                       -- this user's manager (hierarchy)
  active      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_ref, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_role_members_lookup
  ON workflow.role_members (tenant_id, role_ref) WHERE active = true;

-- Round-robin cursor per (tenant, role_ref): the last user_id handed a task, so
-- the next assignment goes to the following candidate in a stable order.
CREATE TABLE IF NOT EXISTS workflow.assignment_cursors (
  tenant_id  uuid         NOT NULL,
  role_ref   varchar(128) NOT NULL,
  last_index integer      NOT NULL DEFAULT -1,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_ref)
);

-- ---------------------------------------------------------------------------
-- 5. Pre-breach reminders (distinct from escalation). reminder_count tracks
-- how many reminder thresholds have already fired for a task, so we never
-- re-send the same threshold and never touch escalation_count.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;
ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- ---------------------------------------------------------------------------
-- 7. Definition templates. A platform/global template definition can be cloned
-- into a tenant as a new draft. is_template marks template rows.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.definitions
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_templates
  ON workflow.definitions (is_template) WHERE is_template = true;
