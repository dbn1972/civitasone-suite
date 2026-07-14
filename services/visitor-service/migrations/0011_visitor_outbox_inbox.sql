-- ═══════════════════════════════════════════════════════════════════════════════
-- 0011 — transactional outbox + consumer-idempotency inbox for visitor-service.
--
-- These shared-infra tables (`_outbox.messages`, `_inbox.processed`) were missing
-- from visitor's migrations 0001-0010; court-service creates the equivalent in its
-- 0001. Without them the outbox relay AND every CQRS consumer (which calls
-- markProcessed first) silently fail on a fresh database. They are intentionally
-- NOT tenant-scoped and carry NO row-level security — the relay scans across
-- tenants. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic          VARCHAR(128) NOT NULL,
    event_type     VARCHAR(128) NOT NULL,
    tenant_id      UUID NOT NULL,
    actor_id       UUID NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);

-- Hot path for the relay: fetch unpublished rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON _outbox.messages(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
    message_id   UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the scheduled purge of old idempotency records.
CREATE INDEX IF NOT EXISTS idx_inbox_processed_time
    ON _inbox.processed(processed_at);

-- Access: the app role reads+writes both; the BYPASSRLS scanner role (0009),
-- used by the cross-tenant relay/workers, needs the outbox + inbox too.
-- Guarded so the migration is safe where either role is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visitor_svc') THEN
    GRANT USAGE ON SCHEMA _outbox, _inbox TO visitor_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages, _inbox.processed TO visitor_svc;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visitor_scanner') THEN
    GRANT USAGE ON SCHEMA _outbox, _inbox TO visitor_scanner;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages TO visitor_scanner;
    GRANT SELECT ON _inbox.processed TO visitor_scanner;
  END IF;
END $$;
