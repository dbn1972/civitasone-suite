-- Purpose: Create outbox and inbox schemas for transactional messaging
-- Rollback: DROP TABLE _inbox.processed; DROP TABLE _outbox.messages; DROP SCHEMA _inbox; DROP SCHEMA _outbox;
-- Affected services: works-service
-- Note: These schemas are shared across all services but each DB instance creates them independently.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic varchar(128) NOT NULL,
  event_type varchar(128) NOT NULL,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;
