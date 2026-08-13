-- Purpose: Create vendor-service schema and initial tables.
-- Schema: vendor (single schema per works-service pattern for same-DB services)
-- Tables: vendor_registrations, vendor_committee_reviews, vendor_licences, vendor_renewals; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA vendor CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS vendor;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== vendor.vendor_registrations =====================
CREATE TABLE IF NOT EXISTS vendor.vendor_registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  registration_number varchar(64) NOT NULL UNIQUE,
  status              varchar(32) NOT NULL DEFAULT 'draft',
  vendor_name         varchar(256) NOT NULL,
  vendor_aadhaar      varchar(12) NOT NULL,
  vendor_phone        varchar(15) NOT NULL,
  vendor_photo        text,
  category            varchar(32) NOT NULL,
  preferred_zone      text,
  allocated_zone      text,
  allocated_spot      text,
  documents           jsonb NOT NULL DEFAULT '[]',
  fee_minor           bigint,
  fee_currency        varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid            boolean NOT NULL DEFAULT false,
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS vendor_reg_tenant_idx ON vendor.vendor_registrations (tenant_id);
CREATE INDEX IF NOT EXISTS vendor_reg_status_idx ON vendor.vendor_registrations (tenant_id, status);

ALTER TABLE vendor.vendor_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_registrations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_registrations' AND schemaname = 'vendor' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON vendor.vendor_registrations
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== vendor.vendor_committee_reviews =====================
CREATE TABLE IF NOT EXISTS vendor.vendor_committee_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  registration_id  uuid NOT NULL,
  committee_type   varchar(64) NOT NULL,
  status           varchar(32) NOT NULL DEFAULT 'pending',
  findings         jsonb,
  recommendation   text,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS vendor_committee_tenant_idx ON vendor.vendor_committee_reviews (tenant_id);

ALTER TABLE vendor.vendor_committee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_committee_reviews FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_committee_reviews' AND schemaname = 'vendor' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON vendor.vendor_committee_reviews
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== vendor.vendor_licences =====================
CREATE TABLE IF NOT EXISTS vendor.vendor_licences (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  licence_number   varchar(64) NOT NULL UNIQUE,
  registration_id  uuid NOT NULL,
  status           varchar(32) NOT NULL DEFAULT 'active',
  issued_at        timestamptz,
  valid_from       timestamptz,
  valid_until      timestamptz,
  zone             text,
  spot_number      text,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS vendor_licences_tenant_idx ON vendor.vendor_licences (tenant_id);

ALTER TABLE vendor.vendor_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_licences FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_licences' AND schemaname = 'vendor' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON vendor.vendor_licences
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== vendor.vendor_renewals =====================
CREATE TABLE IF NOT EXISTS vendor.vendor_renewals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  licence_id          uuid NOT NULL,
  renewal_type        varchar(32) NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'submitted',
  fee_minor           bigint,
  fee_currency        varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until timestamptz,
  new_valid_until     timestamptz,
  details             jsonb,
  decided_by          uuid,
  decided_at          timestamptz,
  decision_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS vendor_renewals_tenant_idx ON vendor.vendor_renewals (tenant_id);

ALTER TABLE vendor.vendor_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_renewals' AND schemaname = 'vendor' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON vendor.vendor_renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
