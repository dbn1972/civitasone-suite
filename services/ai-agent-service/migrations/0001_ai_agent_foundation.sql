-- Purpose: AI Agent Foundation — conversations, transcript messages, copilot turns,
--          agent definitions, guardrail rules, and the AI governance audit trail.
--          Audit input/output columns hold PII-redacted, truncated text only
--          (DPDP Act 2023 — raw personal data is never persisted).
-- Rollback: DROP SCHEMA ai_agent CASCADE; (destructive — requires explicit approval)
-- Affected services: ai-agent-service only
SET lock_timeout = '5s';

-- Schema
CREATE SCHEMA IF NOT EXISTS ai_agent;

-- ────────────────────────────────────────────────────────────────────────────
-- Conversations (chat sessions: active → ended)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  channel_id  uuid NOT NULL,
  profile_id  uuid NOT NULL,
  status      varchar(24) NOT NULL DEFAULT 'active',
  language    varchar(8) NOT NULL DEFAULT 'en',
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant
  ON ai_agent.conversations (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_status
  ON ai_agent.conversations (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_profile
  ON ai_agent.conversations (tenant_id, profile_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_updated
  ON ai_agent.conversations (tenant_id, updated_at DESC);

ALTER TABLE ai_agent.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.conversations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_tenant_isolation ON ai_agent.conversations;
CREATE POLICY conversations_tenant_isolation ON ai_agent.conversations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Messages (transcript — content is guardrail-sanitised before insert)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES ai_agent.conversations(id),
  role            varchar(16) NOT NULL,
  content         text NOT NULL,
  tokens          int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_tenant
  ON ai_agent.messages (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_tenant_conversation
  ON ai_agent.messages (tenant_id, conversation_id, created_at);

ALTER TABLE ai_agent.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_tenant_isolation ON ai_agent.messages;
CREATE POLICY messages_tenant_isolation ON ai_agent.messages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Copilot turns (prompt/response history with source citations)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.copilot_turns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  prompt           text NOT NULL,
  response         text,
  source_citations jsonb NOT NULL DEFAULT '[]',
  model            varchar(64),
  tokens           int,
  latency_ms       int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_copilot_turns_tenant
  ON ai_agent.copilot_turns (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_copilot_turns_tenant_user
  ON ai_agent.copilot_turns (tenant_id, user_id, created_at DESC);

ALTER TABLE ai_agent.copilot_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.copilot_turns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_turns_tenant_isolation ON ai_agent.copilot_turns;
CREATE POLICY copilot_turns_tenant_isolation ON ai_agent.copilot_turns
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Agent definitions (active ⇄ paused, archived terminal)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.agent_definitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       varchar(200) NOT NULL,
  skills     jsonb NOT NULL DEFAULT '[]',
  tools      jsonb NOT NULL DEFAULT '[]',
  status     varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_definitions_tenant
  ON ai_agent.agent_definitions (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_definitions_tenant_status
  ON ai_agent.agent_definitions (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_definitions_skills_gin
  ON ai_agent.agent_definitions USING gin (skills);

ALTER TABLE ai_agent.agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.agent_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_definitions_tenant_isolation ON ai_agent.agent_definitions;
CREATE POLICY agent_definitions_tenant_isolation ON ai_agent.agent_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- AI audit log (governance trail — input/output stored PII-redacted, ≤4000 chars)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.ai_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  agent_id   uuid,
  action     varchar(100) NOT NULL,
  input      text,
  output     text,
  blocked    boolean NOT NULL DEFAULT false,
  reason     varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_audit_log_tenant
  ON ai_agent.ai_audit_log (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_audit_log_tenant_agent
  ON ai_agent.ai_audit_log (tenant_id, agent_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_audit_log_tenant_created
  ON ai_agent.ai_audit_log (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_audit_log_tenant_blocked
  ON ai_agent.ai_audit_log (tenant_id, blocked) WHERE blocked = true;

ALTER TABLE ai_agent.ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.ai_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_audit_log_tenant_isolation ON ai_agent.ai_audit_log;
CREATE POLICY ai_audit_log_tenant_isolation ON ai_agent.ai_audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Guardrail rules (tenant-configurable AI safety policy)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent.guardrail_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       varchar(200) NOT NULL,
  rule_type  varchar(32) NOT NULL,
  pattern    varchar(500),
  config     jsonb NOT NULL DEFAULT '{}',
  severity   varchar(16) NOT NULL DEFAULT 'medium',
  status     varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    int NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardrail_rules_tenant
  ON ai_agent.guardrail_rules (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardrail_rules_tenant_status
  ON ai_agent.guardrail_rules (tenant_id, status);

ALTER TABLE ai_agent.guardrail_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent.guardrail_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardrail_rules_tenant_isolation ON ai_agent.guardrail_rules;
CREATE POLICY guardrail_rules_tenant_isolation ON ai_agent.guardrail_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ────────────────────────────────────────────────────────────────────────────
-- Outbox / Inbox (if not already created by shared migration)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid NOT NULL,
  actor_id       uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- Grants — applied only when the service login role already exists
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_agent_svc') THEN
    GRANT USAGE ON SCHEMA ai_agent TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ai_agent TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai_agent GRANT ALL ON TABLES TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ai_agent TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai_agent GRANT ALL ON SEQUENCES TO ai_agent_svc;

    GRANT USAGE ON SCHEMA _outbox TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _outbox TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox GRANT ALL ON TABLES TO ai_agent_svc;

    GRANT USAGE ON SCHEMA _inbox TO ai_agent_svc;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _inbox TO ai_agent_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox GRANT ALL ON TABLES TO ai_agent_svc;
  END IF;
END $$;
