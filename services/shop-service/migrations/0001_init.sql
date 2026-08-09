-- shop-service initial migration
-- Applied with shop_svc role on civitas_shop.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS shop;

CREATE TABLE IF NOT EXISTS shop.scrutiny_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  scrutiny_type varchar(32) NOT NULL,
  officer_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  findings jsonb,
  deficiency_details text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shop.renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  renewal_type varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'submitted',
  details jsonb,
  fee_amount_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  previous_valid_until timestamptz,
  new_valid_until timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shop.permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_id uuid NOT NULL,
  permit_number varchar(64) NOT NULL UNIQUE,
  establishment_name varchar(256) NOT NULL,
  permit_status varchar(32) NOT NULL DEFAULT 'active',
  issued_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  verification_code varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shop.permit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  action_type varchar(32) NOT NULL,
  reason text,
  effective_from timestamptz,
  notice_details jsonb,
  performed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shop.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  application_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'draft',
  applicant_id uuid NOT NULL,
  establishment_name varchar(256) NOT NULL,
  establishment_type varchar(64) NOT NULL,
  owner_name varchar(256) NOT NULL,
  owner_type varchar(32) NOT NULL,
  premises_address jsonb NOT NULL,
  premises_property_id uuid,
  activity_description text,
  activity_category varchar(64) NOT NULL,
  employee_count integer,
  capacity_details jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  fee_amount_minor bigint,
  fee_currency varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid boolean NOT NULL DEFAULT false,
  fee_transaction_id varchar(128),
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

ALTER TABLE shop.scrutiny_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.scrutiny_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shop.scrutiny_records;
CREATE POLICY tenant_isolation ON shop.scrutiny_records
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE shop.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.renewals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shop.renewals;
CREATE POLICY tenant_isolation ON shop.renewals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE shop.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shop.permits;
CREATE POLICY tenant_isolation ON shop.permits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE shop.permit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.permit_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shop.permit_actions;
CREATE POLICY tenant_isolation ON shop.permit_actions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE shop.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shop.applications;
CREATE POLICY tenant_isolation ON shop.applications
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO shop_svc;
    GRANT USAGE ON SCHEMA _inbox TO shop_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO shop_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO shop_svc;
    GRANT USAGE ON SCHEMA shop TO shop_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shop TO shop_svc;
  END IF;
END $$;
