-- workflow definitions + instance/task linking for cross-module approvals

CREATE TABLE IF NOT EXISTS workflow.definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  code         varchar(64) NOT NULL,
  name         varchar(200) NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  status       varchar(24) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS workflow.definition_nodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id  uuid NOT NULL REFERENCES workflow.definitions(id),
  node_key       varchar(64) NOT NULL,
  name           varchar(200) NOT NULL,
  role_ref       varchar(128),
  sort_order     integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, node_key)
);

ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS definition_id uuid;
ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS ref_type varchar(64);
ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS ref_id uuid;
ALTER TABLE workflow.instances ADD COLUMN IF NOT EXISTS current_node varchar(64);

ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS role_ref varchar(128);
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS ref_type varchar(64);
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS ref_id uuid;
ALTER TABLE workflow.tasks ADD COLUMN IF NOT EXISTS decision varchar(32);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON workflow.tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_instances_ref ON workflow.instances(tenant_id, ref_type, ref_id);
