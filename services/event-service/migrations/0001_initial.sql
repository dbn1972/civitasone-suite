-- Purpose: Create event-service schema and initial tables.
-- Schema: event
-- Tables: event_applications, event_noc_requests, event_permits, event_post_inspections; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA event CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS event;
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

CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== event.event_applications =====================
CREATE TABLE IF NOT EXISTS event.event_applications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  application_number     varchar(64) NOT NULL UNIQUE,
  status                 varchar(32) NOT NULL DEFAULT 'draft',
  organiser_name         varchar(256) NOT NULL,
  organiser_org          varchar(256),
  organiser_phone        varchar(15) NOT NULL,
  event_type             varchar(32) NOT NULL,
  venue_name             varchar(256) NOT NULL,
  venue_address          jsonb NOT NULL,
  start_date             date NOT NULL,
  end_date               date NOT NULL,
  expected_attendance    integer NOT NULL,
  temporary_structures   jsonb,
  sound_permission       boolean NOT NULL DEFAULT false,
  documents              jsonb NOT NULL DEFAULT '[]',
  fee_minor              bigint,
  deposit_minor          bigint,
  currency               varchar(3) NOT NULL DEFAULT 'INR',
  submitted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS event_applications_tenant_idx ON event.event_applications (tenant_id);
CREATE INDEX IF NOT EXISTS event_applications_status_idx ON event.event_applications (tenant_id, status);

ALTER TABLE event.event_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_applications' AND schemaname = 'event' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON event.event_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== event.event_noc_requests =====================
CREATE TABLE IF NOT EXISTS event.event_noc_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  application_id  uuid NOT NULL,
  department      varchar(32) NOT NULL,
  status          varchar(32) NOT NULL DEFAULT 'requested',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  conditions      jsonb,
  officer_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS event_noc_requests_tenant_idx ON event.event_noc_requests (tenant_id);
CREATE INDEX IF NOT EXISTS event_noc_requests_app_idx    ON event.event_noc_requests (application_id);

ALTER TABLE event.event_noc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_noc_requests FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_noc_requests' AND schemaname = 'event' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON event.event_noc_requests
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== event.event_permits =====================
CREATE TABLE IF NOT EXISTS event.event_permits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  permit_number       varchar(64) NOT NULL UNIQUE,
  application_id      uuid NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'issued',
  issued_at           timestamptz,
  valid_from          timestamptz,
  valid_until         timestamptz,
  conditions          jsonb,
  verification_code   varchar(64) NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS event_permits_tenant_idx ON event.event_permits (tenant_id);
CREATE INDEX IF NOT EXISTS event_permits_app_idx    ON event.event_permits (application_id);

ALTER TABLE event.event_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_permits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_permits' AND schemaname = 'event' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON event.event_permits
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== event.event_post_inspections =====================
CREATE TABLE IF NOT EXISTS event.event_post_inspections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  permit_id           uuid NOT NULL,
  inspector_id        uuid NOT NULL,
  inspected_at        timestamptz,
  findings            jsonb,
  damage_assessment   jsonb,
  deposit_decision    varchar(32),
  refund_minor        bigint,
  currency            varchar(3) NOT NULL DEFAULT 'INR',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS event_post_inspections_tenant_idx ON event.event_post_inspections (tenant_id);
CREATE INDEX IF NOT EXISTS event_post_inspections_permit_idx ON event.event_post_inspections (permit_id);

ALTER TABLE event.event_post_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.event_post_inspections FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_post_inspections' AND schemaname = 'event' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON event.event_post_inspections
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
