-- Migration: 0022_integration_ops_dlq.sql
-- Purpose: CAP-060 — integration observability / replay. A generic dead-letter
--          store + action log so operators can list, inspect, requeue/replay,
--          and discard messages that failed terminal delivery on any topic.
-- Rollback: DROP TABLE IF EXISTS integration_ops.dead_letter_action;
--           DROP TABLE IF EXISTS integration_ops.dead_letter;
--           DROP SCHEMA IF EXISTS integration_ops;
-- Affected services: admin-service (integration-ops module). Additive + idempotent.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS integration_ops;

-- current_tenant_id() is created by earlier migrations (0006/0013/0014); guard
-- so this migration never needs to own it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    CREATE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER
      AS 'SELECT NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid';
  END IF;
END $$;

-- ── dead_letter: one failed message awaiting operator action ─────────────────
CREATE TABLE IF NOT EXISTS integration_ops.dead_letter (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  topic          varchar(120) NOT NULL,
  message_id     varchar(120),
  source_service varchar(64),
  correlation_id varchar(120),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error          text,
  retry_count    integer NOT NULL DEFAULT 0,
  status         varchar(16) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','requeued','discarded')),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_error_at  timestamptz NOT NULL DEFAULT now(),
  requeued_at    timestamptz,
  discarded_at   timestamptz,
  actioned_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1
);

-- Idempotent ingestion: a replayed failure for the same (topic,message_id) per
-- tenant updates the existing row rather than duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS dead_letter_tenant_topic_msg_key
  ON integration_ops.dead_letter (tenant_id, topic, message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dead_letter_tenant_status
  ON integration_ops.dead_letter (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dead_letter_tenant_topic
  ON integration_ops.dead_letter (tenant_id, topic);

ALTER TABLE integration_ops.dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_ops.dead_letter FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON integration_ops.dead_letter;
CREATE POLICY tenant_isolation_policy ON integration_ops.dead_letter
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── dead_letter_action: append-only audit of operator actions ───────────────
CREATE TABLE IF NOT EXISTS integration_ops.dead_letter_action (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  dead_letter_id uuid NOT NULL,
  action         varchar(16) NOT NULL CHECK (action IN ('requeue','discard')),
  note           text,
  actor_id       uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_action_tenant_dl
  ON integration_ops.dead_letter_action (tenant_id, dead_letter_id, created_at);

ALTER TABLE integration_ops.dead_letter_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_ops.dead_letter_action FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON integration_ops.dead_letter_action;
CREATE POLICY tenant_isolation_policy ON integration_ops.dead_letter_action
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
