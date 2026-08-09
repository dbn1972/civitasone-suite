-- vendor-service initial migration
-- Applied with vendor_svc role on civitas_vendor.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS vendor;

CREATE TABLE IF NOT EXISTS vendor.vendor_committee_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  committee_type varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  findings jsonb,
  recommendation text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendor.vendor_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  licence_number varchar(64) NOT NULL UNIQUE,
  registration_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  issued_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  zone text,
  spot_number text,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendor.vendor_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  licence_id uuid NOT NULL,
  renewal_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'submitted',
  fee_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until timestamptz,
  new_valid_until timestamptz,
  details jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendor.vendor_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registration_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  vendor_name varchar(256) NOT NULL,
  vendor_aadhaar varchar(12) NOT NULL,
  vendor_phone varchar(15) NOT NULL,
  vendor_photo text,
  category varchar(32) NOT NULL,
  preferred_zone text,
  allocated_zone text,
  allocated_spot text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);


-- ── _outbox / _inbox (CQRS) ───────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS _outbox;
CREATE SCHEMA IF NOT EXISTS _inbox;

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic          varchar(128) NOT NULL,
  event_type     varchar(128) NOT NULL,
  tenant_id      uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  correlation_id varchar(64) NOT NULL,
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id   uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE vendor.vendor_committee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_committee_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.vendor_committee_reviews;
CREATE POLICY tenant_isolation ON vendor.vendor_committee_reviews
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE vendor.vendor_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_licences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.vendor_licences;
CREATE POLICY tenant_isolation ON vendor.vendor_licences
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE vendor.vendor_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_renewals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.vendor_renewals;
CREATE POLICY tenant_isolation ON vendor.vendor_renewals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE vendor.vendor_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.vendor_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.vendor_registrations;
CREATE POLICY tenant_isolation ON vendor.vendor_registrations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE _outbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE _outbox.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _outbox.messages;
CREATE POLICY tenant_isolation ON _outbox.messages
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── Grants ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vendor_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO vendor_svc;
    GRANT USAGE ON SCHEMA _inbox TO vendor_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO vendor_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO vendor_svc;
    GRANT USAGE ON SCHEMA vendor TO vendor_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vendor TO vendor_svc;
  END IF;
END $$;
