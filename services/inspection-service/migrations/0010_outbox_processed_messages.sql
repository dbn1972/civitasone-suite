-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0010_outbox_processed_messages.sql
-- Service:   inspection-service (gateway /api/v1/inspection) — DB civitas_inspection
--
-- Purpose:
--   Creates the `outbox` and `processed_messages` tables in the public schema.
--   These support the transactional outbox pattern and consumer idempotency:
--
--   • outbox: Domain events are written in the same DB transaction as the entity
--     mutation, then relayed to SQS by the outbox relay worker. The relay queries
--     for rows where sent_at IS NULL, publishes them, and stamps sent_at.
--
--   • processed_messages: Tracks which inbound messages have been idempotently
--     processed by consumers. Before processing a command, the consumer calls
--     markProcessed(tx, msg.messageId) — if the row already exists the message
--     is skipped (idempotent).
--
--   These tables are in the public/default schema (not a separate PG schema)
--   because they span all modules. No RLS is applied — they are internal
--   infrastructure, not tenant-facing data.
--
--   This migration is ADDITIVE and IDEMPOTENT: every object uses IF NOT EXISTS.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval):
--   DROP INDEX IF EXISTS idx_processed_messages_tenant_processed_at;
--   DROP INDEX IF EXISTS idx_outbox_unsent;
--   DROP TABLE IF EXISTS processed_messages;
--   DROP TABLE IF EXISTS outbox;
--
-- Affected services: inspection-service only (own database).
-- Requirements: 1.4, 1.8
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: outbox
--   Transactional outbox for reliable event publishing. Domain events are
--   INSERTed within the same transaction as the entity write. The outbox relay
--   worker polls for unsent rows (sent_at IS NULL), publishes to SQS, then
--   stamps sent_at. correlation_id enables end-to-end tracing across services.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    correlation_id  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: processed_messages
--   Idempotency guard for consumers. message_id is the PRIMARY KEY (unique by
--   definition). Before processing any inbound command, the consumer inserts
--   into this table — if the row already exists (conflict on PK), the message
--   is skipped. tenant_id and topic provide context for cleanup/purge jobs.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS processed_messages (
    message_id      TEXT PRIMARY KEY,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
--   Tables are brand-new and empty at migration time, so plain CREATE INDEX is
--   safe (instant, non-blocking). All IF NOT EXISTS for idempotent re-runs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Partial index for the relay worker: find unsent messages efficiently.
CREATE INDEX IF NOT EXISTS idx_outbox_unsent
    ON outbox (sent_at)
    WHERE sent_at IS NULL;

-- Support cleanup/purge jobs that remove old processed records by tenant + age.
CREATE INDEX IF NOT EXISTS idx_processed_messages_tenant_processed_at
    ON processed_messages (tenant_id, processed_at);
