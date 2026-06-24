-- workflow-service engine hardening: edges, versioning, SLA, transition history, SoD.
-- Additive + idempotent only.

-- ---------------------------------------------------------------------------
-- 1. Definition versioning + node enrichment
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.definitions ADD COLUMN IF NOT EXISTS description varchar(1000);

-- The legacy UNIQUE (tenant_id, code) blocks versioning (multiple versions share a code).
-- Replace it with UNIQUE (tenant_id, code, version) so version N+1 can coexist with archived N.
ALTER TABLE workflow.definitions DROP CONSTRAINT IF EXISTS definitions_tenant_id_code_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'definitions_tenant_code_version_key'
  ) THEN
    ALTER TABLE workflow.definitions
      ADD CONSTRAINT definitions_tenant_code_version_key UNIQUE (tenant_id, code, version);
  END IF;
END $$;

-- node typing for split/join/task and SLA defaults
ALTER TABLE workflow.definition_nodes ADD COLUMN IF NOT EXISTS node_type varchar(16) NOT NULL DEFAULT 'task';
ALTER TABLE workflow.definition_nodes ADD COLUMN IF NOT EXISTS sla_minutes integer;

-- ---------------------------------------------------------------------------
-- 2. Edges (from_node -> to_node with optional condition)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.definition_edges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id  uuid NOT NULL REFERENCES workflow.definitions(id),
  from_node      varchar(64) NOT NULL,
  to_node        varchar(64) NOT NULL,
  condition      varchar(512),          -- e.g. "amount > 100000"; null = unconditional
  sort_order     integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edges_def_from ON workflow.definition_edges(definition_id, from_node);

-- ---------------------------------------------------------------------------
-- 3. Instance context + pinned version
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS definition_version integer;
ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 4. SLA + node linkage + escalation on tasks
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS node_key varchar(64);
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS escalation_count integer NOT NULL DEFAULT 0;
-- sweeper hot path: open tasks past due that have not yet been escalated
CREATE INDEX IF NOT EXISTS idx_tasks_due ON workflow.tasks(due_at) WHERE status = 'pending' AND escalated_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Immutable transition history (append-only audit of every state change)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow.transition_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  instance_id    uuid NOT NULL,
  task_id        uuid,
  from_node      varchar(64),
  to_node        varchar(64),
  action         varchar(32) NOT NULL,   -- create | advance | branch | split | join | return | escalate | complete | reject
  decision       varchar(32),
  actor_id       uuid NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transition_instance ON workflow.transition_history(instance_id, created_at);

-- Immutable-by-design: block UPDATE and DELETE at the DB level (append-only).
CREATE OR REPLACE FUNCTION workflow.block_transition_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workflow.transition_history is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transition_no_update ON workflow.transition_history;
CREATE TRIGGER trg_transition_no_update
  BEFORE UPDATE OR DELETE ON workflow.transition_history
  FOR EACH ROW EXECUTE FUNCTION workflow.block_transition_mutation();

-- ---------------------------------------------------------------------------
-- 6. SoD: record which actor acted on which task/node (for repeat-actor blocking)
-- ---------------------------------------------------------------------------
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS completed_by uuid;
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS sod_override boolean NOT NULL DEFAULT false;
