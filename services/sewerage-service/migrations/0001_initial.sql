-- Purpose: Create sewerage-service schema and initial tables.
-- Schema: civitas_sewerage (matches every schema.ts module's
--   pgSchema("civitas_sewerage") literal 1:1 -- no naming drift to reproduce
--   here, unlike drainage-service's sibling migration).
-- Tables: sewerage_applications, sewerage_connections, sewerage_bills,
--   sewerage_complaints, sewerage_field_records, sewerage_desludging_bookings;
--   plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA civitas_sewerage CASCADE; DROP SCHEMA _outbox CASCADE; DROP SCHEMA _inbox CASCADE;
--
-- NOTE: this service had zero test files AND no migrations directory at all
-- prior to this change -- src/modules/*/schema.ts (drizzle) fully defines six
-- tables but nothing in the repo ever turned that into applyable SQL, and
-- sewerage-service was also absent from scripts/ci/bootstrap-postgres.sh's
-- SERVICE_DBS map, so its role/database never existed in CI or on a fresh
-- dev cluster either -- the same "role/database never created" gap already
-- fixed for cdp/catalogue/loyalty/journey/sec5-batch3/etc. See
-- infra/db/bootstrap/bootstrap_sewerage.sql for the role/db/schema bootstrap
-- half of this fix.

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS civitas_sewerage;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sewerage_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== civitas_sewerage.sewerage_applications =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_applications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  application_number     varchar(32) NOT NULL UNIQUE,
  status                 varchar(32) NOT NULL DEFAULT 'submitted',
  property_ref           text,
  water_connection_ref   text,
  connection_class       varchar(24) NOT NULL,
  site_details           jsonb,
  fee_minor              integer,
  fee_paid               boolean NOT NULL DEFAULT false,
  feasibility_report     jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_applications_tenant_idx ON civitas_sewerage.sewerage_applications (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_applications_status_idx ON civitas_sewerage.sewerage_applications (tenant_id, status);

ALTER TABLE civitas_sewerage.sewerage_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_applications' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_sewerage.sewerage_connections =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  connection_number   varchar(32) NOT NULL UNIQUE,
  application_id      uuid NOT NULL,
  status              varchar(24) NOT NULL DEFAULT 'active',
  activation_date     date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_connections_tenant_idx ON civitas_sewerage.sewerage_connections (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_connections_app_idx    ON civitas_sewerage.sewerage_connections (tenant_id, application_id);

ALTER TABLE civitas_sewerage.sewerage_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_connections FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_connections' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_connections
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_sewerage.sewerage_bills =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_bills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  connection_id     uuid NOT NULL,
  bill_number       varchar(32) NOT NULL UNIQUE,
  billing_period    varchar(24) NOT NULL,
  amount_minor      integer NOT NULL,
  due_date          date NOT NULL,
  status            varchar(24) NOT NULL DEFAULT 'generated',
  payment_ref       varchar(64),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_bills_tenant_idx     ON civitas_sewerage.sewerage_bills (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_bills_connection_idx ON civitas_sewerage.sewerage_bills (tenant_id, connection_id);

ALTER TABLE civitas_sewerage.sewerage_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_bills FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_bills' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_bills
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_sewerage.sewerage_complaints =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_complaints (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  complaint_number   varchar(32) NOT NULL UNIQUE,
  reported_by        uuid NOT NULL,
  location           jsonb,
  complaint_type     varchar(32) NOT NULL,
  description        text,
  photo              text,
  severity           varchar(16),
  status             varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to        uuid,
  resolution         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_complaints_tenant_idx   ON civitas_sewerage.sewerage_complaints (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_complaints_status_idx   ON civitas_sewerage.sewerage_complaints (tenant_id, status);
CREATE INDEX IF NOT EXISTS sewerage_complaints_assigned_idx ON civitas_sewerage.sewerage_complaints (tenant_id, assigned_to);

ALTER TABLE civitas_sewerage.sewerage_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_complaints FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_complaints' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_complaints
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_sewerage.sewerage_field_records =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_field_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  complaint_id      uuid,
  booking_id        uuid,
  asset_ref         text,
  manhole_ref       text,
  work_performed    text,
  before_photo      text,
  after_photo       text,
  closed_by         uuid,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_field_records_tenant_idx    ON civitas_sewerage.sewerage_field_records (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_field_records_complaint_idx ON civitas_sewerage.sewerage_field_records (tenant_id, complaint_id);
CREATE INDEX IF NOT EXISTS sewerage_field_records_booking_idx   ON civitas_sewerage.sewerage_field_records (tenant_id, booking_id);

ALTER TABLE civitas_sewerage.sewerage_field_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_field_records FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_field_records' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_field_records
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== civitas_sewerage.sewerage_desludging_bookings =====================
CREATE TABLE IF NOT EXISTS civitas_sewerage.sewerage_desludging_bookings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  booking_number          varchar(32) NOT NULL UNIQUE,
  requested_by            uuid NOT NULL,
  address                 jsonb,
  tank_capacity_litres    integer,
  requested_date          date,
  requested_slot          varchar(24),
  status                  varchar(24) NOT NULL DEFAULT 'requested',
  vehicle_id              text,
  fee_minor               integer,
  fee_paid                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sewerage_desludging_bookings_tenant_idx ON civitas_sewerage.sewerage_desludging_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS sewerage_desludging_bookings_status_idx ON civitas_sewerage.sewerage_desludging_bookings (tenant_id, status);

ALTER TABLE civitas_sewerage.sewerage_desludging_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE civitas_sewerage.sewerage_desludging_bookings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sewerage_desludging_bookings' AND schemaname = 'civitas_sewerage' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON civitas_sewerage.sewerage_desludging_bookings
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
