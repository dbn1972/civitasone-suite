-- Purpose: Create refund-service schema and initial tables.
-- Schema: refund (single schema per works-service pattern for same-DB services)
-- Tables: refund_requests, refund_approvals, refund_disbursements; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA refund CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS refund;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refund_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== refund.refund_requests =====================
CREATE TABLE IF NOT EXISTS refund.refund_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  request_number            varchar(64) NOT NULL UNIQUE,
  status                    varchar(32) NOT NULL DEFAULT 'requested',
  applicant_name            varchar(256) NOT NULL,
  applicant_phone           varchar(15) NOT NULL,
  original_service_type     varchar(64) NOT NULL,
  original_transaction_ref  text NOT NULL,
  original_amount_minor     bigint NOT NULL,
  refund_amount_minor       bigint NOT NULL,
  refund_reason             varchar(32) NOT NULL,
  description               text,
  documents                 jsonb NOT NULL DEFAULT '[]',
  currency                  char(3) NOT NULL DEFAULT 'INR',
  submitted_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL,
  updated_by                uuid NOT NULL,
  version                   integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS refund_requests_tenant_idx ON refund.refund_requests (tenant_id);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON refund.refund_requests (tenant_id, status);

ALTER TABLE refund.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_requests FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refund_requests' AND schemaname = 'refund' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON refund.refund_requests
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== refund.refund_approvals =====================
CREATE TABLE IF NOT EXISTS refund.refund_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  request_id       uuid NOT NULL,
  approval_level   integer NOT NULL,
  approver_id      uuid NOT NULL,
  decision         varchar(32) NOT NULL,
  remarks          text,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS refund_approvals_tenant_idx ON refund.refund_approvals (tenant_id);
CREATE INDEX IF NOT EXISTS refund_approvals_request_idx ON refund.refund_approvals (request_id);

ALTER TABLE refund.refund_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_approvals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refund_approvals' AND schemaname = 'refund' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON refund.refund_approvals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== refund.refund_disbursements =====================
CREATE TABLE IF NOT EXISTS refund.refund_disbursements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  request_id               uuid NOT NULL,
  bank_account_details     jsonb NOT NULL,
  disbursement_ref         text,
  disbursed_amount_minor   bigint NOT NULL,
  disbursed_at             timestamptz,
  status                   varchar(32) NOT NULL DEFAULT 'initiated',
  failure_reason           text,
  reconciled_at            timestamptz,
  reconciled_by            uuid,
  currency                 varchar(3) NOT NULL DEFAULT 'INR',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL,
  updated_by               uuid NOT NULL,
  version                  integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS refund_disbursements_tenant_idx ON refund.refund_disbursements (tenant_id);
CREATE INDEX IF NOT EXISTS refund_disbursements_status_idx ON refund.refund_disbursements (tenant_id, status);

ALTER TABLE refund.refund_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund.refund_disbursements FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refund_disbursements' AND schemaname = 'refund' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON refund.refund_disbursements
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
