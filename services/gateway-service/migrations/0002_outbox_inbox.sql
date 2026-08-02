-- Migration: 0002_outbox_inbox.sql
-- Purpose: transactional outbox + inbox for gateway catalogue CQRS consumers.
-- Service: gateway-service — DB civitas_gateway, role gateway_svc.
-- Rollback: DROP SCHEMA IF EXISTS _inbox CASCADE; DROP SCHEMA IF EXISTS _outbox CASCADE;
-- Notes: Additive + idempotent. Matches metadata-service / fleet outbox shape.

SET lock_timeout = '5s';

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
CREATE INDEX IF NOT EXISTS idx_gateway_outbox_unpublished
  ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
