-- 0020_inbox_outbox_schema.sql
--
-- Purpose: create the `_outbox.messages` and `_inbox.processed` tables that
-- EVERY consumer in this service actually reads/writes at runtime, via
-- shared/outbox.ts -> @civitasone/outbox (markProcessed, enqueue, startRelay).
--
-- DEFECT THIS FIXES (P0 — discovered while adding real-DB round-trip tests for
-- the SVC-109 tour-plan approval consumer; see 0019)
-- 0010_outbox_processed_messages.sql created `public.outbox` and
-- `public.processed_messages` — tables that NOTHING in src/ references. The
-- actual package (packages/outbox/src/index.ts) defines:
--     export const outbox = pgSchema("_outbox");
--     export const inbox  = pgSchema("_inbox");
--     outboxMessages = outbox.table("messages", ...)
--     processed      = inbox.table("processed", ...)
-- and every consumer's first line is `markProcessed(tx, msg.messageId)`, which
-- inserts into `_inbox.processed`; every write path calls `enqueue(tx, ...)`,
-- which inserts into `_outbox.messages`. Neither schema nor table existed in
-- civitas_inspection. Confirmed directly against the live test database
-- (civitas_inspection on the shared civitasone-postgres container): `\dn`
-- listed 15 module schemas and no `_inbox`/`_outbox`, and a real (non-mocked)
-- call to markProcessed() failed with
--     relation "_inbox.processed" does not exist
--
-- IMPACT: every consumer in every one of this service's 9 modules — not just
-- assignment/tour-plan — has been unable to persist anything against a real
-- Postgres since the service was first stood up. It was invisible because
-- inspection-service's entire test suite (1095 tests) mocks `shared/db.js`;
-- there was no test in this service that ever executed a consumer against a
-- real database until the round-trip tests added alongside this migration
-- (tests/tour-plan-approval-consumer.test.ts).
--
-- This migration does NOT touch the orphaned `public.outbox` /
-- `public.processed_messages` tables from 0010 — dropping them is a separate,
-- reviewable decision (they hold no live data since nothing ever wrote to
-- them successfully; the app can't reach them). This migration only adds the
-- schema the application actually uses, matching packages/outbox exactly
-- (column-for-column) and the sibling convention already applied correctly in
-- other services (e.g. services/inventory-service/migrations/0001_init.sql).
--
-- Rollback:
--   DROP TABLE IF EXISTS _inbox.processed;
--   DROP TABLE IF EXISTS _outbox.messages;
--   DROP SCHEMA IF EXISTS _inbox;
--   DROP SCHEMA IF EXISTS _outbox;
--   (Destructive once consumers have run against it — prefer forward fixes.)
--
-- Affected services: inspection-service only (own database). Additive and
-- idempotent.

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

-- Supports the outbox relay's poll for unsent rows (published_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_outbox_messages_unpublished
  ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
