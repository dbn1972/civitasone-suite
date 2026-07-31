-- Purpose: Create the transactional outbox/inbox tables this service writes to.
--          field-service calls enqueue() from @civitasone/outbox on every
--          mutation, which INSERTs into _outbox.messages. That table was never
--          created by an earlier migration, so on a fresh database every write
--          failed with: relation "_outbox.messages" does not exist.
--          The mock-based test suite could not catch this because enqueue() is
--          mocked there.
-- Rollback: DROP SCHEMA _outbox CASCADE; DROP SCHEMA _inbox CASCADE;
--           (destructive — shared infrastructure, requires explicit approval)
-- Affected services: field-service
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

-- Partial index: the relay only ever scans unpublished rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

-- Consumer idempotency ledger: markProcessed(tx, messageId) writes here first.
CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'field_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox TO field_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO field_svc;

    GRANT USAGE ON SCHEMA _inbox TO field_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox TO field_svc;
    ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO field_svc;
  END IF;
END $$;
