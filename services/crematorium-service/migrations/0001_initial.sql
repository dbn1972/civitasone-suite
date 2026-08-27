-- Purpose: Create crematorium-service schema and initial tables.
-- Schema: crematorium
-- Tables: crematorium_facilities, crematorium_bookings, crematorium_service_register; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA crematorium CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS crematorium;
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

CREATE INDEX IF NOT EXISTS idx_crematorium_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== crematorium.crematorium_facilities =====================
CREATE TABLE IF NOT EXISTS crematorium.crematorium_facilities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  facility_name    text NOT NULL,
  facility_type    varchar(32) NOT NULL,
  address          jsonb NOT NULL,
  ward             varchar(64),
  total_slots      integer NOT NULL,
  operating_hours  jsonb,
  contact_person   text,
  contact_phone    varchar(20),
  status           varchar(32) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS crematorium_facilities_tenant_idx ON crematorium.crematorium_facilities (tenant_id);

ALTER TABLE crematorium.crematorium_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crematorium.crematorium_facilities FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crematorium_facilities' AND schemaname = 'crematorium' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON crematorium.crematorium_facilities
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== crematorium.crematorium_bookings =====================
CREATE TABLE IF NOT EXISTS crematorium.crematorium_bookings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  booking_number         varchar(64) NOT NULL UNIQUE,
  facility_id            uuid NOT NULL,
  applicant_name         text NOT NULL,
  applicant_phone        varchar(20) NOT NULL,
  applicant_relation     varchar(32),
  deceased_name          text NOT NULL,
  deceased_age           integer,
  deceased_gender        varchar(16),
  death_certificate_ref  text,
  service_type           varchar(32) NOT NULL,
  requested_date         date NOT NULL,
  requested_slot         varchar(32),
  status                 varchar(32) NOT NULL DEFAULT 'requested',
  slot_number            text,
  fee_minor              bigint,
  currency               varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid               boolean NOT NULL DEFAULT false,
  payment_ref            text,
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS crematorium_bookings_tenant_idx   ON crematorium.crematorium_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS crematorium_bookings_status_idx   ON crematorium.crematorium_bookings (tenant_id, status);
CREATE INDEX IF NOT EXISTS crematorium_bookings_facility_idx ON crematorium.crematorium_bookings (facility_id);

ALTER TABLE crematorium.crematorium_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crematorium.crematorium_bookings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crematorium_bookings' AND schemaname = 'crematorium' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON crematorium.crematorium_bookings
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== crematorium.crematorium_service_register =====================
CREATE TABLE IF NOT EXISTS crematorium.crematorium_service_register (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  booking_id                  uuid NOT NULL,
  facility_id                 uuid NOT NULL,
  service_date                date NOT NULL,
  slot_number                 text,
  service_type                varchar(32) NOT NULL,
  performed_by                uuid NOT NULL,
  notes                       text,
  completion_certificate_ref  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NOT NULL,
  updated_by                  uuid NOT NULL,
  version                     integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS crematorium_svc_register_tenant_idx  ON crematorium.crematorium_service_register (tenant_id);
CREATE INDEX IF NOT EXISTS crematorium_svc_register_booking_idx ON crematorium.crematorium_service_register (booking_id);

ALTER TABLE crematorium.crematorium_service_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE crematorium.crematorium_service_register FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crematorium_service_register' AND schemaname = 'crematorium' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON crematorium.crematorium_service_register
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
