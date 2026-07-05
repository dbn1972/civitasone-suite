-- 0015: Advanced workflow engine — Camunda/SAP/Oracle parity
-- Capabilities: message/signal events, decision tables, ad-hoc forwarding,
-- visual designer metadata, responsibility matrix, compensation, multi-instance.
-- Additive + idempotent only.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. MESSAGE & SIGNAL EVENTS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Message subscriptions: instances waiting for a correlated external message
CREATE TABLE IF NOT EXISTS workflow.message_subscriptions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL,
  instance_id     uuid         NOT NULL,
  task_id         uuid         NOT NULL,
  message_name    varchar(128) NOT NULL,
  correlation_key varchar(256) NOT NULL,
  node_key        varchar(64)  NOT NULL,
  timeout_at      timestamptz,
  status          varchar(16)  NOT NULL DEFAULT 'active',
  matched_at      timestamptz,
  matched_payload jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_msg_sub_status CHECK (status IN ('active', 'matched', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_msg_sub_correlate
  ON workflow.message_subscriptions(tenant_id, message_name, correlation_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_msg_sub_instance
  ON workflow.message_subscriptions(instance_id);

CREATE INDEX IF NOT EXISTS idx_msg_sub_timeout
  ON workflow.message_subscriptions(timeout_at)
  WHERE status = 'active' AND timeout_at IS NOT NULL;

-- Signal subscriptions: instances listening for a broadcast signal
CREATE TABLE IF NOT EXISTS workflow.signal_subscriptions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL,
  instance_id     uuid         NOT NULL,
  task_id         uuid         NOT NULL,
  signal_name     varchar(128) NOT NULL,
  node_key        varchar(64)  NOT NULL,
  status          varchar(16)  NOT NULL DEFAULT 'active',
  matched_at      timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_sig_sub_status CHECK (status IN ('active', 'matched', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_sig_sub_signal
  ON workflow.signal_subscriptions(tenant_id, signal_name)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sig_sub_instance
  ON workflow.signal_subscriptions(instance_id);

-- Definition node additions for message/signal
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS message_name varchar(128),
  ADD COLUMN IF NOT EXISTS correlation_key_expr varchar(256),
  ADD COLUMN IF NOT EXISTS signal_name varchar(128),
  ADD COLUMN IF NOT EXISTS message_topic varchar(128),
  ADD COLUMN IF NOT EXISTS message_payload_expr varchar(512);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. DECISION TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflow.decision_tables (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL,
  code        varchar(64)  NOT NULL,
  name        varchar(200) NOT NULL,
  version     integer      NOT NULL DEFAULT 1,
  status      varchar(24)  NOT NULL DEFAULT 'draft',
  hit_policy  varchar(16)  NOT NULL DEFAULT 'first',
  inputs      jsonb        NOT NULL DEFAULT '[]',
  outputs     jsonb        NOT NULL DEFAULT '[]',
  rules       jsonb        NOT NULL DEFAULT '[]',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL,
  CONSTRAINT chk_dt_status CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT chk_dt_hit_policy CHECK (hit_policy IN ('first', 'collect', 'unique')),
  UNIQUE(tenant_id, code, version)
);

CREATE INDEX IF NOT EXISTS idx_decision_tables_lookup
  ON workflow.decision_tables(tenant_id, code, status);

-- Definition node addition for decision table reference
ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS decision_table_code varchar(64);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. AD-HOC TASK FORWARDING
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflow.task_forwards (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL,
  task_id     uuid         NOT NULL,
  instance_id uuid         NOT NULL,
  from_user   uuid         NOT NULL,
  to_user     uuid         NOT NULL,
  remarks     varchar(512),
  action      varchar(16)  NOT NULL DEFAULT 'forward',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_forward_action CHECK (action IN ('forward', 'recall'))
);

CREATE INDEX IF NOT EXISTS idx_task_forwards_task
  ON workflow.task_forwards(task_id);

CREATE INDEX IF NOT EXISTS idx_task_forwards_instance
  ON workflow.task_forwards(instance_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. VISUAL DESIGNER METADATA
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS position_x integer,
  ADD COLUMN IF NOT EXISTS position_y integer;

ALTER TABLE workflow.definition_edges
  ADD COLUMN IF NOT EXISTS waypoints jsonb;

ALTER TABLE workflow.definitions
  ADD COLUMN IF NOT EXISTS layout jsonb;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. RESPONSIBILITY MATRIX + SUBSTITUTION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflow.responsibility_matrix (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL,
  role_ref        varchar(128) NOT NULL,
  condition_expr  varchar(512),
  user_id         uuid         NOT NULL,
  priority        integer      NOT NULL DEFAULT 1,
  active          boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resp_matrix_lookup
  ON workflow.responsibility_matrix(tenant_id, role_ref)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS workflow.substitution_rules (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL,
  user_id         uuid         NOT NULL,
  substitute_id   uuid         NOT NULL,
  from_date       date         NOT NULL,
  to_date         date,
  reason          varchar(256),
  active          boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_substitution_lookup
  ON workflow.substitution_rules(tenant_id, user_id)
  WHERE active = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. COMPENSATION HANDLERS
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS compensation_handler_key varchar(64);

ALTER TABLE workflow.instances
  ADD COLUMN IF NOT EXISTS completed_nodes jsonb NOT NULL DEFAULT '[]';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. MULTI-INSTANCE TASKS
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE workflow.definition_nodes
  ADD COLUMN IF NOT EXISTS multi_instance_collection varchar(128),
  ADD COLUMN IF NOT EXISTS multi_instance_mode varchar(16),
  ADD COLUMN IF NOT EXISTS multi_instance_completion varchar(32);

ALTER TABLE workflow.tasks
  ADD COLUMN IF NOT EXISTS multi_instance_index integer,
  ADD COLUMN IF NOT EXISTS multi_instance_parent_id uuid;

CREATE INDEX IF NOT EXISTS idx_tasks_mi_parent
  ON workflow.tasks(multi_instance_parent_id)
  WHERE multi_instance_parent_id IS NOT NULL;

