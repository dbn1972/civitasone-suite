-- Purpose: Create market-service schema and initial tables.
-- Schema: market
-- Tables: market_properties, market_allotments, market_demands, market_lifecycle_requests; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA market CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

-- ===================== OUTBOX / INBOX =====================
CREATE TABLE IF NOT EXISTS _outbox.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           varchar(128) NOT NULL,
  event_type      varchar(128) NOT NULL,
  tenant_id       uuid NOT NULL,
  actor_id        uuid NOT NULL,
  correlation_id  varchar(64) NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== market.market_properties =====================
CREATE TABLE IF NOT EXISTS market.market_properties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  property_code       text NOT NULL UNIQUE,
  market_name         text NOT NULL,
  property_type       varchar(32) NOT NULL,
  location            jsonb,
  area                text,
  area_unit           varchar(16) NOT NULL DEFAULT 'sqft',
  floor_number        integer,
  monthly_rent_minor  bigint,
  currency            varchar(3) NOT NULL DEFAULT 'INR',
  status              varchar(32) NOT NULL DEFAULT 'available',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS market_properties_tenant_idx ON market.market_properties (tenant_id);

ALTER TABLE market.market_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.market_properties FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_properties' AND schemaname = 'market' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON market.market_properties
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== market.market_allotments =====================
CREATE TABLE IF NOT EXISTS market.market_allotments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  allotment_number         varchar(64) NOT NULL UNIQUE,
  property_id              uuid NOT NULL,
  allottee_name            text NOT NULL,
  allottee_phone           varchar(20),
  allottee_aadhaar         varchar(12),
  allotment_type           varchar(32) NOT NULL,
  allotment_date           date,
  agreement_start_date     date,
  agreement_end_date       date,
  monthly_rent_minor       bigint,
  security_deposit_minor   bigint,
  currency                 varchar(3) NOT NULL DEFAULT 'INR',
  status                   varchar(32) NOT NULL DEFAULT 'applied',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS market_allotments_tenant_idx   ON market.market_allotments (tenant_id);
CREATE INDEX IF NOT EXISTS market_allotments_property_idx ON market.market_allotments (property_id);

ALTER TABLE market.market_allotments ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.market_allotments FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_allotments' AND schemaname = 'market' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON market.market_allotments
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== market.market_demands =====================
CREATE TABLE IF NOT EXISTS market.market_demands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  allotment_id   uuid NOT NULL,
  demand_month   varchar(7) NOT NULL,
  amount_minor   bigint NOT NULL,
  late_fee_minor bigint NOT NULL DEFAULT 0,
  currency       varchar(3) NOT NULL DEFAULT 'INR',
  due_date       date NOT NULL,
  status         varchar(32) NOT NULL DEFAULT 'generated',
  paid_at        timestamptz,
  payment_ref    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS market_demands_tenant_idx    ON market.market_demands (tenant_id);
CREATE INDEX IF NOT EXISTS market_demands_allotment_idx ON market.market_demands (allotment_id);

ALTER TABLE market.market_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.market_demands FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_demands' AND schemaname = 'market' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON market.market_demands
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== market.market_lifecycle_requests =====================
CREATE TABLE IF NOT EXISTS market.market_lifecycle_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  allotment_id          uuid NOT NULL,
  request_number        text NOT NULL UNIQUE,
  request_type          varchar(32) NOT NULL,
  status                varchar(32) NOT NULL DEFAULT 'submitted',
  transferee_name       text,
  transferee_aadhaar    varchar(12),
  reason                text,
  approved_by           uuid,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS market_lifecycle_requests_tenant_idx    ON market.market_lifecycle_requests (tenant_id);
CREATE INDEX IF NOT EXISTS market_lifecycle_requests_allotment_idx ON market.market_lifecycle_requests (allotment_id);

ALTER TABLE market.market_lifecycle_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.market_lifecycle_requests FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'market_lifecycle_requests' AND schemaname = 'market' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON market.market_lifecycle_requests
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
