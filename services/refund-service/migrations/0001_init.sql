-- refund-service initial migration
-- Applied with refund_svc role on civitas_refund.
-- Generated from src/modules/*/schema.ts — do not invent columns beyond schema.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS refund;

CREATE TABLE IF NOT EXISTS refund.refund_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  approval_level integer NOT NULL,
  approver_id uuid NOT NULL,
  decision varchar(32) NOT NULL,
  remarks text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS refund.refund_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  bank_account_details jsonb NOT NULL,
  disbursement_ref text,
  disbursed_amount_minor bigint NOT NULL,
  disbursed_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'initiated',
  failure_reason text,
  reconciled_at timestamptz,
  reconciled_by uuid,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS refund.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_number varchar(64) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'requested',
  applicant_name varchar(256) NOT NULL,
  applicant_phone varchar(15) NOT NULL,
  original_service_type varchar(64) NOT NULL,
  original_transaction_ref text NOT NULL,
  original_amount_minor bigint NOT NULL,
  refund_amount_minor bigint NOT NULL,
  refund_reason varchar(32) NOT NULL,
  description text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency char(3) NOT NULL DEFAULT 'INR',
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

ALTER TABLE refund.refund_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refund.refund_approvals;
CREATE POLICY tenant_isolation ON refund.refund_approvals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE refund.refund_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_disbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refund.refund_disbursements;
CREATE POLICY tenant_isolation ON refund.refund_disbursements
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE refund.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refund.refund_requests;
CREATE POLICY tenant_isolation ON refund.refund_requests
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'refund_svc') THEN
    GRANT USAGE ON SCHEMA _outbox TO refund_svc;
    GRANT USAGE ON SCHEMA _inbox TO refund_svc;
    GRANT SELECT, INSERT, UPDATE ON _outbox.messages TO refund_svc;
    GRANT SELECT, INSERT ON _inbox.processed TO refund_svc;
    GRANT USAGE ON SCHEMA refund TO refund_svc;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA refund TO refund_svc;
  END IF;
END $$;
