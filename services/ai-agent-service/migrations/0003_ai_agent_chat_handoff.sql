-- Purpose: P2-3 conversational AI human handoff —
--            a conversation may now be escalated from the bot to a person
--            (active → handed_off → ended) carrying the context the bot
--            already gathered, so the customer does not repeat themselves.
--          handoff_context holds the guardrail-sanitised transcript snapshot
--          only (DPDP Act 2023 — raw personal data is never persisted).
--
-- Additive only: every statement is IF NOT EXISTS / idempotent, and the new
-- columns are all nullable, so the running release (which never writes them)
-- keeps working unchanged. No backfill is required — a NULL handed_off_at
-- correctly means "never escalated".
--
-- `status` has no CHECK constraint (migration 0001), so admitting the new
-- 'handed_off' value needs no constraint change; the state machine is enforced
-- in chat/domain.ts#validateStatusTransition.
--
-- Rollback: ALTER TABLE ai_agent.conversations
--             DROP COLUMN IF EXISTS handed_off_at, DROP COLUMN IF EXISTS handoff_reason,
--             DROP COLUMN IF EXISTS handoff_note, DROP COLUMN IF EXISTS handoff_queue,
--             DROP COLUMN IF EXISTS handoff_context;
--           DROP INDEX IF EXISTS ai_agent.idx_conversations_tenant_handoff_queue;
--           (destructive — requires explicit approval)
-- Affected services: ai-agent-service only
SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS ai_agent;

ALTER TABLE ai_agent.conversations
  ADD COLUMN IF NOT EXISTS handed_off_at   timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_reason  varchar(32),
  ADD COLUMN IF NOT EXISTS handoff_note    text,
  ADD COLUMN IF NOT EXISTS handoff_queue   varchar(64),
  ADD COLUMN IF NOT EXISTS handoff_context jsonb;

-- Supervisors work the escalation backlog by queue; idx_conversations_tenant_status
-- (migration 0001) already covers the status-only filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_handoff_queue
  ON ai_agent.conversations (tenant_id, handoff_queue)
  WHERE handoff_queue IS NOT NULL;
