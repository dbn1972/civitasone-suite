-- advertisement-service initial migration
-- Applied with advertisement_svc role on civitas_advertisement.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS adv_applications;

CREATE TABLE IF NOT EXISTS adv_applications.adv_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  advertiser_name text NOT NULL,
  advertiser_org text NOT NULL,
  advertisement_type varchar(32) NOT NULL,
  location jsonb NOT NULL,
  dimensions jsonb NOT NULL,
  structural_details jsonb,
  creative text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS adv_approvals;

CREATE TABLE IF NOT EXISTS adv_approvals.adv_scrutiny_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  scrutiny_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  findings jsonb,
  officer_id uuid NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS adv_enforcement;

CREATE TABLE IF NOT EXISTS adv_enforcement.adv_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  violation_number varchar(64) NOT NULL UNIQUE,
  permit_id uuid,
  status varchar(32) NOT NULL DEFAULT 'reported',
  violation_type varchar(64) NOT NULL,
  description text NOT NULL,
  location jsonb NOT NULL,
  reported_by uuid NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  notice_issued_at timestamptz,
  notice_details jsonb,
  penalty_minor bigint,
  penalty_currency varchar(3) DEFAULT 'INR',
  penalty_imposed_at timestamptz,
  removal_ordered_at timestamptz,
  removal_deadline date,
  removal_recorded_at timestamptz,
  removal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE SCHEMA IF NOT EXISTS adv_permits;

CREATE TABLE IF NOT EXISTS adv_permits.adv_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_number varchar(64) NOT NULL UNIQUE,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'issued',
  issued_at timestamptz,
  valid_from date,
  valid_until date,
  location jsonb NOT NULL,
  advertisement_type varchar(32) NOT NULL,
  verification_code varchar(32) NOT NULL UNIQUE,
  suspended_at timestamptz,
  suspension_reason varchar(512),
  cancelled_at timestamptz,
  cancellation_reason varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS adv_permits.adv_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  renewal_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  fee_minor bigint,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until date,
  new_valid_until date,
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

ALTER TABLE adv_applications.adv_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_applications.adv_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adv_applications.adv_applications;
CREATE POLICY tenant_isolation ON adv_applications.adv_applications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE adv_approvals.adv_scrutiny_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_approvals.adv_scrutiny_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adv_approvals.adv_scrutiny_records;
CREATE POLICY tenant_isolation ON adv_approvals.adv_scrutiny_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE adv_enforcement.adv_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_enforcement.adv_violations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adv_enforcement.adv_violations;
CREATE POLICY tenant_isolation ON adv_enforcement.adv_violations
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE adv_permits.adv_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_permits.adv_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adv_permits.adv_permits;
CREATE POLICY tenant_isolation ON adv_permits.adv_permits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE adv_permits.adv_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_permits.adv_renewals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON adv_permits.adv_renewals;
CREATE POLICY tenant_isolation ON adv_permits.adv_renewals
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'advertisement_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO advertisement_svc;
    GRANT USAGE ON SCHEMA _inbox TO advertisement_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO advertisement_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO advertisement_svc;
    GRANT USAGE ON SCHEMA adv_applications TO advertisement_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adv_applications TO advertisement_svc;
    GRANT USAGE ON SCHEMA adv_approvals TO advertisement_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adv_approvals TO advertisement_svc;
    GRANT USAGE ON SCHEMA adv_enforcement TO advertisement_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adv_enforcement TO advertisement_svc;
    GRANT USAGE ON SCHEMA adv_permits TO advertisement_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adv_permits TO advertisement_svc;
  END IF;
END $$;
