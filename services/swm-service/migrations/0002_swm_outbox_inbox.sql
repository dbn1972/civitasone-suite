-- ═══════════════════════════════════════════════════════════════════════════════
-- 0002 — transactional outbox + consumer-idempotency inbox for swm-service.
--
-- Mirrors visitor-service/migrations/0011_visitor_outbox_inbox.sql exactly.
-- Without these shared-infra tables (`_outbox.messages`, `_inbox.processed`),
-- the outbox relay (worker.ts startRelay) AND every one of swm-service's 15
-- CQRS consumers (which all call markProcessed first, inside the same
-- transaction as the business write — see modules/*/consumer.ts) fail
-- immediately on a fresh database. They are intentionally NOT tenant-scoped
-- and carry NO row-level security — swm-service has no cross-tenant
-- sweeper/scanner role (unlike visitor/helpdesk/crm/finance), but the relay
-- still needs to scan across all tenants' unpublished rows in one DB. Safe to
-- re-run.
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

-- Supports the scheduled purge of old idempotency records (purgeOutbox).
CREATE INDEX IF NOT EXISTS idx_inbox_processed_time
    ON _inbox.processed(processed_at);

-- Access: the app role reads+writes both. No BYPASSRLS scanner role exists
-- for swm-service (no cross-tenant sweeper in the codebase as of this PR).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swm_svc') THEN
    GRANT USAGE ON SCHEMA _outbox, _inbox TO swm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON _outbox.messages, _inbox.processed TO swm_svc;
  END IF;
END $$;
