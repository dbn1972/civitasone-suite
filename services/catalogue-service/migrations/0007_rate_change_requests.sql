-- Migration: 0007_rate_change_requests.sql
-- Purpose: Make the inbound cross-service contract `billing.rate.change_requested`
--          (declared in catalogue-service src/topics.ts CONSUMED_EVENTS) real. Each
--          inbound request is validated against the catalogue and its outcome is
--          recorded here, so an acceptance or rejection is auditable rather than
--          silently dropped.
--
--          Money is stored as bigint MINOR UNITS (paise) and is serialised as a
--          STRING in JSON; arithmetic uses BigInt(). No float, no numeric-as-number.
--
--          Every payload-derived column is NULLABLE on purpose: billing-service owns
--          the payload shape, so a malformed foreign event must still be recordable
--          as a rejection. Only envelope-derived columns are NOT NULL.
--
-- Rollback (manual, requires tech-lead approval):
--   DROP TABLE IF EXISTS catalogue.rate_change_requests;
--
-- Affected services: catalogue-service (owner). billing-service is the publisher of
--                    the consumed event; no billing schema is touched.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS catalogue.rate_change_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  -- Dedupe anchor: the queue messageId of the inbound event. The UNIQUE constraint
  -- below is a database-level backstop behind markProcessed() in the consumer.
  source_message_id    uuid NOT NULL,
  -- billing-service's own request identifier. Opaque string, not a catalogue id.
  request_id           varchar(200),
  product_id           uuid,
  rate_id              uuid,
  -- MONEY RULE: minor units (paise) as bigint. Exact above 2^53; serialised as a
  -- JSON string by the consumer so JavaScript number precision is never used.
  requested_rate_minor bigint,
  currency             char(3),
  effective_from       date,
  request_reason       varchar(500),
  outcome              varchar(24) NOT NULL
    CHECK (outcome IN ('accepted', 'rejected')),
  rejection_code       varchar(64),
  rejection_reason     varchar(500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              int NOT NULL DEFAULT 1,
  CONSTRAINT uq_rate_change_requests_source UNIQUE (tenant_id, source_message_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_change_requests_product
  ON catalogue.rate_change_requests (tenant_id, product_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_change_requests_outcome
  ON catalogue.rate_change_requests (tenant_id, outcome, created_at DESC);

COMMENT ON COLUMN catalogue.rate_change_requests.requested_rate_minor IS 'Requested rate in minor units (paise) as bigint. Serialised as a JSON string. Never a float.';
COMMENT ON COLUMN catalogue.rate_change_requests.source_message_id IS 'Queue messageId of the inbound billing.rate.change_requested event; dedupe backstop behind markProcessed().';

-- ─── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE catalogue.rate_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.rate_change_requests FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'catalogue' AND tablename = 'rate_change_requests' AND policyname = 'catalogue_rate_change_requests_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY catalogue_rate_change_requests_tenant_isolation ON catalogue.rate_change_requests
      USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
      WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)';
  END IF;
END $$;

-- ─── Guarded GRANT (never creates a LOGIN role) ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogue_svc') THEN
    GRANT USAGE ON SCHEMA catalogue TO catalogue_svc;
    GRANT SELECT, INSERT, UPDATE ON catalogue.rate_change_requests TO catalogue_svc;
  END IF;
END $$;
