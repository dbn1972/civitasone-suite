-- Purpose: Create fire-service schemas and initial tables.
-- Schemas: fire_applications, fire_inspections, fire_lifecycle, fire_nocs
--   (NOTE: unlike every sibling service, which uses ONE Postgres schema named after the
--   short service name, fire-service's src/modules/*/schema.ts declares FOUR separate
--   pgSchema() namespaces, one per module. This migration matches the code exactly as
--   written; the four-schemas-instead-of-one inconsistency is flagged separately as a
--   fleet-consistency finding, not silently "fixed" into one schema here, because doing so
--   would require rewriting all four schema.ts files' pgSchema() calls to match — a decision
--   for the fix PR, not something to diverge from what the TypeScript ORM layer expects.)
-- Tables: fire_applications, fire_inspections, fire_renewals, fire_nocs; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA fire_applications CASCADE; DROP SCHEMA fire_inspections CASCADE;
--           DROP SCHEMA fire_lifecycle CASCADE; DROP SCHEMA fire_nocs CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS fire_applications;
CREATE SCHEMA IF NOT EXISTS fire_inspections;
CREATE SCHEMA IF NOT EXISTS fire_lifecycle;
CREATE SCHEMA IF NOT EXISTS fire_nocs;
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

CREATE INDEX IF NOT EXISTS idx_fire_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== fire_applications.fire_applications =====================
CREATE TABLE IF NOT EXISTS fire_applications.fire_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  application_number    varchar(64) NOT NULL UNIQUE,
  status                varchar(32) NOT NULL DEFAULT 'draft',
  building_name         text NOT NULL,
  building_address      jsonb NOT NULL,
  occupancy_type        varchar(32) NOT NULL,
  building_height       text,
  number_of_floors      integer,
  built_up_area         text,
  fire_safety_measures  jsonb,
  documents             jsonb,
  fee_minor             bigint,
  fee_currency          char(3) NOT NULL DEFAULT 'INR',
  fee_paid              boolean NOT NULL DEFAULT false,
  submitted_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS fire_applications_tenant_idx ON fire_applications.fire_applications (tenant_id);

ALTER TABLE fire_applications.fire_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_applications.fire_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fire_applications' AND schemaname = 'fire_applications' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON fire_applications.fire_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== fire_inspections.fire_inspections =====================
CREATE TABLE IF NOT EXISTS fire_inspections.fire_inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  application_id   uuid NOT NULL,
  inspector_id     uuid NOT NULL,
  scheduled_date   date NOT NULL,
  inspected_at     timestamptz,
  findings         jsonb,
  deficiencies     jsonb,
  status           varchar(32) NOT NULL DEFAULT 'scheduled',
  recommendation   varchar(32),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS fire_inspections_tenant_idx ON fire_inspections.fire_inspections (tenant_id);
CREATE INDEX IF NOT EXISTS fire_inspections_app_idx    ON fire_inspections.fire_inspections (application_id);

ALTER TABLE fire_inspections.fire_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_inspections.fire_inspections FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fire_inspections' AND schemaname = 'fire_inspections' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON fire_inspections.fire_inspections
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== fire_lifecycle.fire_renewals =====================
CREATE TABLE IF NOT EXISTS fire_lifecycle.fire_renewals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  noc_id                 uuid NOT NULL,
  renewal_type           varchar(32) NOT NULL,
  status                 varchar(32) NOT NULL DEFAULT 'requested',
  fee_minor              bigint,
  previous_valid_until   date,
  new_valid_until        date,
  decision               varchar(32),
  decided_by             uuid,
  decided_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS fire_renewals_tenant_idx ON fire_lifecycle.fire_renewals (tenant_id);
CREATE INDEX IF NOT EXISTS fire_renewals_noc_idx    ON fire_lifecycle.fire_renewals (noc_id);

ALTER TABLE fire_lifecycle.fire_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_lifecycle.fire_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fire_renewals' AND schemaname = 'fire_lifecycle' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON fire_lifecycle.fire_renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== fire_nocs.fire_nocs =====================
CREATE TABLE IF NOT EXISTS fire_nocs.fire_nocs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  noc_number          varchar(64) NOT NULL UNIQUE,
  application_id      uuid NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'issued',
  issued_at           timestamptz,
  valid_from          date,
  valid_until         date,
  conditions          jsonb,
  verification_code   varchar(32),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS fire_nocs_tenant_idx ON fire_nocs.fire_nocs (tenant_id);
CREATE INDEX IF NOT EXISTS fire_nocs_app_idx    ON fire_nocs.fire_nocs (application_id);

ALTER TABLE fire_nocs.fire_nocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_nocs.fire_nocs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fire_nocs' AND schemaname = 'fire_nocs' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON fire_nocs.fire_nocs
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
