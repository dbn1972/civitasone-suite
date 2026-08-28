-- Purpose: Create roadcut-service schema and initial tables.
-- Schema: roadcut (single schema per works-service pattern for same-DB services)
-- Tables: roadcut_applications, roadcut_permits, roadcut_inspections, roadcut_restorations; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA roadcut CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS roadcut;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_roadcut_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== roadcut.roadcut_applications =====================
CREATE TABLE IF NOT EXISTS roadcut.roadcut_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  application_number  varchar(64) NOT NULL UNIQUE,
  status              varchar(32) NOT NULL DEFAULT 'draft',
  applicant_name      varchar(256) NOT NULL,
  applicant_org       varchar(256),
  purpose             varchar(64) NOT NULL,
  location            jsonb NOT NULL,
  road_type           varchar(32) NOT NULL,
  cutting_length      text NOT NULL,
  cutting_width       text NOT NULL,
  cutting_depth       text NOT NULL,
  documents           jsonb NOT NULL DEFAULT '[]',
  fee_minor           bigint,
  deposit_minor       bigint,
  currency            char(3) NOT NULL DEFAULT 'INR',
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS roadcut_applications_tenant_idx ON roadcut.roadcut_applications (tenant_id);
CREATE INDEX IF NOT EXISTS roadcut_applications_status_idx ON roadcut.roadcut_applications (tenant_id, status);

ALTER TABLE roadcut.roadcut_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roadcut_applications' AND schemaname = 'roadcut' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON roadcut.roadcut_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== roadcut.roadcut_permits =====================
CREATE TABLE IF NOT EXISTS roadcut.roadcut_permits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  permit_number       varchar(64) NOT NULL UNIQUE,
  application_id      uuid NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'issued',
  issued_at           timestamptz,
  work_start_date     date NOT NULL,
  work_end_date       date NOT NULL,
  extended_until      date,
  conditions          jsonb,
  verification_code   varchar(64) NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS roadcut_permits_tenant_idx ON roadcut.roadcut_permits (tenant_id);
CREATE INDEX IF NOT EXISTS roadcut_permits_status_idx ON roadcut.roadcut_permits (tenant_id, status);
CREATE INDEX IF NOT EXISTS roadcut_permits_application_idx ON roadcut.roadcut_permits (application_id);

ALTER TABLE roadcut.roadcut_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_permits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roadcut_permits' AND schemaname = 'roadcut' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON roadcut.roadcut_permits
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== roadcut.roadcut_inspections =====================
CREATE TABLE IF NOT EXISTS roadcut.roadcut_inspections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  permit_id             uuid NOT NULL,
  inspection_type       varchar(32) NOT NULL,
  inspector_id          uuid NOT NULL,
  scheduled_date        date NOT NULL,
  inspected_at          timestamptz,
  findings              jsonb,
  photos                jsonb,
  status                varchar(32) NOT NULL DEFAULT 'scheduled',
  restoration_quality   varchar(32),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS roadcut_inspections_tenant_idx ON roadcut.roadcut_inspections (tenant_id);
CREATE INDEX IF NOT EXISTS roadcut_inspections_status_idx ON roadcut.roadcut_inspections (tenant_id, status);
CREATE INDEX IF NOT EXISTS roadcut_inspections_permit_idx ON roadcut.roadcut_inspections (permit_id);

ALTER TABLE roadcut.roadcut_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_inspections FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roadcut_inspections' AND schemaname = 'roadcut' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON roadcut.roadcut_inspections
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== roadcut.roadcut_restorations =====================
CREATE TABLE IF NOT EXISTS roadcut.roadcut_restorations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  permit_id                uuid NOT NULL,
  restoration_start_date   date,
  restoration_end_date     date,
  quality                  varchar(32) NOT NULL DEFAULT 'pending',
  deposit_refund_status    varchar(32) NOT NULL DEFAULT 'held',
  refund_minor             bigint,
  currency                 varchar(3) NOT NULL DEFAULT 'INR',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS roadcut_restorations_tenant_idx ON roadcut.roadcut_restorations (tenant_id);
CREATE INDEX IF NOT EXISTS roadcut_restorations_permit_idx ON roadcut.roadcut_restorations (permit_id);

ALTER TABLE roadcut.roadcut_restorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadcut.roadcut_restorations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roadcut_restorations' AND schemaname = 'roadcut' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON roadcut.roadcut_restorations
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
