-- Purpose: Create animal-service schema and initial tables.
-- Schema: animal
-- Tables: animal_complaints, animal_operations, animal_registrations; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA animal CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS animal;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_animal_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== animal.animal_complaints =====================
CREATE TABLE IF NOT EXISTS animal.animal_complaints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  complaint_number varchar(64) NOT NULL UNIQUE,
  reported_by      uuid NOT NULL,
  location         jsonb NOT NULL,
  animal_type      varchar(32) NOT NULL,
  complaint_type   varchar(32) NOT NULL,
  description      text,
  photo            text,
  severity         varchar(16) NOT NULL DEFAULT 'medium',
  status           varchar(32) NOT NULL DEFAULT 'reported',
  assigned_to      uuid,
  assigned_team    varchar(64),
  resolved_at      timestamptz,
  resolution       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS animal_complaints_tenant_idx ON animal.animal_complaints (tenant_id);
CREATE INDEX IF NOT EXISTS animal_complaints_status_idx ON animal.animal_complaints (tenant_id, status);

ALTER TABLE animal.animal_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_complaints FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'animal_complaints' AND schemaname = 'animal' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON animal.animal_complaints
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== animal.animal_operations =====================
CREATE TABLE IF NOT EXISTS animal.animal_operations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  complaint_id     uuid NOT NULL,
  operation_type   varchar(32) NOT NULL,
  performed_by     uuid NOT NULL,
  performed_at     timestamptz NOT NULL,
  animal_tag_id    text,
  location         jsonb,
  notes            text,
  before_photo     text,
  after_photo      text,
  shelter_ref      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS animal_ops_tenant_idx     ON animal.animal_operations (tenant_id);
CREATE INDEX IF NOT EXISTS animal_ops_complaint_idx  ON animal.animal_operations (complaint_id);

ALTER TABLE animal.animal_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_operations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'animal_operations' AND schemaname = 'animal' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON animal.animal_operations
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== animal.animal_registrations =====================
CREATE TABLE IF NOT EXISTS animal.animal_registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  registration_number   varchar(64) NOT NULL UNIQUE,
  owner_name            text NOT NULL,
  owner_phone           varchar(20) NOT NULL,
  owner_address         jsonb NOT NULL,
  animal_type           varchar(32) NOT NULL,
  breed                 varchar(64),
  name                  text,
  color                 text,
  age                   integer,
  sex                   varchar(8),
  microchip_id          text,
  vaccination_records   jsonb,
  photo                 text,
  status                varchar(32) NOT NULL DEFAULT 'active',
  valid_until           date,
  fee_minor             bigint,
  currency              varchar(3) NOT NULL DEFAULT 'INR',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS animal_reg_tenant_idx ON animal.animal_registrations (tenant_id);

ALTER TABLE animal.animal_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal.animal_registrations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'animal_registrations' AND schemaname = 'animal' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON animal.animal_registrations
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
