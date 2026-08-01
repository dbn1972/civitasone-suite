-- Purpose: Sprint 2 AI agent capabilities —
--            AG-001 multi-agent orchestration with depth/hop safety valves
--            AG-003 no-code agent authoring (draft → published → archived)
--            AG-004 autonomous interaction quality scoring (100% of interactions)
--            AG-005 open agent-interoperability protocol registrations
--            F.4    governed ReAct tool definitions + reasoning step trace
--          All free-text columns hold PII-redacted, truncated text only
--          (DPDP Act 2023 — raw personal data is never persisted).
--
-- NOTE on AG-003 table naming: `ai_agent.agent_definitions` already exists
--   (migration 0001) as the RUNTIME agent registry with status active|paused|
--   archived. The authoring lifecycle needs status draft|published|archived,
--   which cannot be CHECK-constrained onto the existing table without breaking
--   live rows. The authoring surface therefore gets its own table,
--   `ai_agent.agent_authoring_definitions`, and publishing an authored agent is
--   what promotes it into the runtime registry. Additive, no destructive change.
--
-- Rollback: DROP TABLE ai_agent.react_steps, ai_agent.tool_definitions,
--           ai_agent.protocol_registrations, ai_agent.interaction_quality,
--           ai_agent.agent_authoring_definitions, ai_agent.orchestration_hops,
--           ai_agent.orchestrations; (destructive — requires explicit approval)
-- Affected services: ai-agent-service only
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS ai_agent;

-- ────────────────────────────────────────────────────────────────────────────
-- AG-001 Orchestrations (running → completed | failed | aborted)
--   depth/max_depth and hop_count/max_hops are the recursion safety valves:
--   without BOTH, a cycle of two agents handing work back and forth would loop
--   forever at a constant depth. See agents/orchestration-domain.ts#canHandoff.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.orchestrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  root_agent_id uuid NOT NULL,
  status        varchar(24) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
  depth         int NOT NULL DEFAULT 0,
  max_depth     int NOT NULL DEFAULT 5,
  hop_count     int NOT NULL DEFAULT 0,
  max_hops      int NOT NULL DEFAULT 20,
  reason        varchar(500),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestrations_tenant
  ON ai_agent.orchestrations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestrations_tenant_status
  ON ai_agent.orchestrations (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestrations_tenant_root_agent
  ON ai_agent.orchestrations (tenant_id, root_agent_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestrations_tenant_started
  ON ai_agent.orchestrations (tenant_id, started_at DESC);

ALTER TABLE ai_agent.orchestrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.orchestrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orchestrations_tenant_isolation ON ai_agent.orchestrations;
CREATE POLICY orchestrations_tenant_isolation ON ai_agent.orchestrations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- AG-001 Orchestration hops (append-only handoff trace — never updated)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.orchestration_hops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  orchestration_id uuid NOT NULL REFERENCES ai_agent.orchestrations(id),
  from_agent_id    uuid NOT NULL,
  to_agent_id      uuid NOT NULL,
  depth            int NOT NULL DEFAULT 0,
  reason           text,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  version          int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestration_hops_tenant
  ON ai_agent.orchestration_hops (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orchestration_hops_tenant_orch
  ON ai_agent.orchestration_hops (tenant_id, orchestration_id, occurred_at);

ALTER TABLE ai_agent.orchestration_hops ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.orchestration_hops FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orchestration_hops_tenant_isolation ON ai_agent.orchestration_hops;
CREATE POLICY orchestration_hops_tenant_isolation ON ai_agent.orchestration_hops
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- AG-003 No-code agent authoring (draft → published → archived)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.agent_authoring_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          varchar(200) NOT NULL,
  description   text,
  system_prompt text NOT NULL DEFAULT '',
  tools         jsonb NOT NULL DEFAULT '[]',
  model_config  jsonb NOT NULL DEFAULT '{}',
  status        varchar(24) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'archived')),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  version       int NOT NULL DEFAULT 1,
  CONSTRAINT uq_agent_authoring_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_authoring_tenant
  ON ai_agent.agent_authoring_definitions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_authoring_tenant_status
  ON ai_agent.agent_authoring_definitions (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_authoring_tenant_updated
  ON ai_agent.agent_authoring_definitions (tenant_id, updated_at DESC);

ALTER TABLE ai_agent.agent_authoring_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.agent_authoring_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_authoring_tenant_isolation ON ai_agent.agent_authoring_definitions;
CREATE POLICY agent_authoring_tenant_isolation ON ai_agent.agent_authoring_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- AG-004 Interaction quality (one row per conversation turn — 100% coverage)
--   Scores are numeric(5,4) and are returned as STRINGS by the API: floating
--   point round-tripping would silently change a stored score.
--   `safety` is a hard gate — see governance/quality-domain.ts#computeOverall.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.interaction_quality (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL,
  turn_id         uuid NOT NULL,
  relevance       numeric(5,4),
  coherence       numeric(5,4),
  safety          numeric(5,4),
  overall         numeric(5,4),
  flagged         boolean NOT NULL DEFAULT false,
  flag_reason     text,
  scored_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1,
  CONSTRAINT uq_interaction_quality_turn UNIQUE (tenant_id, conversation_id, turn_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_quality_tenant
  ON ai_agent.interaction_quality (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_quality_tenant_conv
  ON ai_agent.interaction_quality (tenant_id, conversation_id, scored_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interaction_quality_flagged
  ON ai_agent.interaction_quality (tenant_id, scored_at DESC) WHERE flagged = true;

ALTER TABLE ai_agent.interaction_quality ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.interaction_quality FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interaction_quality_tenant_isolation ON ai_agent.interaction_quality;
CREATE POLICY interaction_quality_tenant_isolation ON ai_agent.interaction_quality
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- AG-005 Protocol registrations (open agent interoperability)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.protocol_registrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  protocol     varchar(32) NOT NULL
                 CHECK (protocol IN ('mcp', 'a2a', 'openai_tools', 'anthropic_tools')),
  endpoint     varchar(500) NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]',
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  version      int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_protocol_registrations_tenant
  ON ai_agent.protocol_registrations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_protocol_registrations_tenant_protocol
  ON ai_agent.protocol_registrations (tenant_id, protocol);

ALTER TABLE ai_agent.protocol_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.protocol_registrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS protocol_registrations_tenant_isolation ON ai_agent.protocol_registrations;
CREATE POLICY protocol_registrations_tenant_isolation ON ai_agent.protocol_registrations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- F.4 Tool definitions (governed ReAct tool catalogue per agent domain)
--   requires_approval = true is the governance boundary: the agent may PLAN a
--   step that uses the tool but the step is never marked executed until a human
--   approves it. See tools/domain.ts#decideReactStep.
--   Default CRM/helpdesk tools are NOT seeded here: tenant_id is NOT NULL so a
--   tenant-agnostic template row is impossible, and hardcoding a tenant id in a
--   migration would leak one tenant's data into every install. Tenants seed via
--   POST /v1/ai/tools/seed-defaults instead (templates in tools/domain.ts).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.tool_definitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  agent_domain     varchar(24) NOT NULL
                     CHECK (agent_domain IN ('crm', 'helpdesk', 'finance', 'hrms', 'generic')),
  tool_name        varchar(120) NOT NULL,
  description      text,
  input_schema     jsonb NOT NULL DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT false,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          int NOT NULL DEFAULT 1,
  CONSTRAINT uq_tool_definitions_tenant_domain_name UNIQUE (tenant_id, agent_domain, tool_name)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tool_definitions_tenant
  ON ai_agent.tool_definitions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tool_definitions_tenant_domain
  ON ai_agent.tool_definitions (tenant_id, agent_domain);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tool_definitions_tenant_approval
  ON ai_agent.tool_definitions (tenant_id, requires_approval) WHERE requires_approval = true;

ALTER TABLE ai_agent.tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.tool_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_definitions_tenant_isolation ON ai_agent.tool_definitions;
CREATE POLICY tool_definitions_tenant_isolation ON ai_agent.tool_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- F.4 ReAct steps (append-only reasoning trace: thought → action → observation)
--   `executed = false` + status 'pending_approval' is the governed state for a
--   tool whose definition requires human approval.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.react_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  agent_id         uuid NOT NULL,
  orchestration_id uuid,
  tool_id          uuid,
  step_no          int NOT NULL DEFAULT 1,
  thought          text NOT NULL,
  action           varchar(120) NOT NULL,
  action_input     jsonb NOT NULL DEFAULT '{}',
  observation      text,
  status           varchar(24) NOT NULL DEFAULT 'executed'
                     CHECK (status IN ('executed', 'pending_approval', 'rejected')),
  executed         boolean NOT NULL DEFAULT false,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_react_steps_tenant
  ON ai_agent.react_steps (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_react_steps_tenant_agent
  ON ai_agent.react_steps (tenant_id, agent_id, occurred_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_react_steps_tenant_pending
  ON ai_agent.react_steps (tenant_id, occurred_at DESC) WHERE status = 'pending_approval';

ALTER TABLE ai_agent.react_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.react_steps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS react_steps_tenant_isolation ON ai_agent.react_steps;
CREATE POLICY react_steps_tenant_isolation ON ai_agent.react_steps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Grants — applied only when the service login role already exists.
-- A LOGIN role is NEVER created by a migration (provisioning owns that).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_agent_svc') THEN
    GRANT USAGE ON SCHEMA ai_agent TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ai_agent TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai_agent GRANT ALL ON TABLES TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ai_agent TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai_agent GRANT ALL ON SEQUENCES TO ai_agent_svc;
  END IF;
END $$;
