-- Purpose: Create trade-service schema and initial tables.
-- Schema: trade (single schema per works-service pattern for same-DB services)
-- Tables: trade_applications, trade_scrutiny_records, trade_licences, licence_actions, trade_renewals; plus _outbox/_inbox.
-- NOTE: licence_actions has no updated_at/created_by/updated_by (append-only
-- action log; performed_by substitutes), mirroring shop.permit_actions.
-- Matches services/trade-service/src/modules/*/schema.ts as written; flagged
-- for the trade-service deep-dive to judge as by-design vs. a gap.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA trade CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS trade;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== trade.trade_applications =====================
CREATE TABLE IF NOT EXISTS trade.trade_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  application_number    varchar(64) NOT NULL UNIQUE,
  status                varchar(32) NOT NULL DEFAULT 'draft',
  business_name         varchar(256) NOT NULL,
  trade_category        varchar(64) NOT NULL,
  sub_category          varchar(64),
  owner_name            varchar(256) NOT NULL,
  premises_address      jsonb NOT NULL,
  area_in_sqft          integer,
  employee_count        integer,
  documents             jsonb NOT NULL DEFAULT '[]',
  fee_minor             bigint,
  fee_currency          varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid              boolean NOT NULL DEFAULT false,
  fee_transaction_id    varchar(128),
  submitted_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS trade_applications_tenant_idx ON trade.trade_applications (tenant_id);
CREATE INDEX IF NOT EXISTS trade_applications_status_idx ON trade.trade_applications (tenant_id, status);

ALTER TABLE trade.trade_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trade_applications' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.trade_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== trade.trade_scrutiny_records =====================
CREATE TABLE IF NOT EXISTS trade.trade_scrutiny_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  application_id       uuid NOT NULL,
  scrutiny_type        varchar(32) NOT NULL,
  officer_id           uuid NOT NULL,
  status               varchar(32) NOT NULL DEFAULT 'pending',
  findings             jsonb,
  deficiency_details   text,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS trade_scrutiny_records_tenant_idx ON trade.trade_scrutiny_records (tenant_id);
CREATE INDEX IF NOT EXISTS trade_scrutiny_records_application_idx ON trade.trade_scrutiny_records (application_id);

ALTER TABLE trade.trade_scrutiny_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_scrutiny_records FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trade_scrutiny_records' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.trade_scrutiny_records
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== trade.trade_licences =====================
CREATE TABLE IF NOT EXISTS trade.trade_licences (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  application_id         uuid NOT NULL,
  licence_number         varchar(64) NOT NULL UNIQUE,
  status                 varchar(32) NOT NULL DEFAULT 'active',
  trade_category         varchar(64) NOT NULL,
  issued_at              timestamptz,
  valid_from             timestamptz,
  valid_until            timestamptz,
  suspended_at           timestamptz,
  suspension_reason      text,
  cancelled_at           timestamptz,
  cancellation_reason    text,
  verification_code      varchar(64) NOT NULL UNIQUE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS trade_licences_tenant_idx ON trade.trade_licences (tenant_id);
CREATE INDEX IF NOT EXISTS trade_licences_status_idx ON trade.trade_licences (tenant_id, status);
CREATE INDEX IF NOT EXISTS trade_licences_application_idx ON trade.trade_licences (application_id);

ALTER TABLE trade.trade_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_licences FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trade_licences' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.trade_licences
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== trade.licence_actions =====================
-- NOTE: no updated_at/created_by/updated_by — see file header.
CREATE TABLE IF NOT EXISTS trade.licence_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  licence_id        uuid NOT NULL,
  action_type       varchar(32) NOT NULL,
  reason            text,
  effective_from    timestamptz,
  notice_details    jsonb,
  performed_by      uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS trade_licence_actions_tenant_idx ON trade.licence_actions (tenant_id);
CREATE INDEX IF NOT EXISTS trade_licence_actions_licence_idx ON trade.licence_actions (licence_id);

ALTER TABLE trade.licence_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.licence_actions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'licence_actions' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.licence_actions
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== trade.trade_renewals =====================
CREATE TABLE IF NOT EXISTS trade.trade_renewals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  licence_id             uuid NOT NULL,
  renewal_type           varchar(32) NOT NULL,
  status                 varchar(32) NOT NULL DEFAULT 'submitted',
  details                jsonb,
  fee_minor              bigint,
  fee_currency           varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid               boolean NOT NULL DEFAULT false,
  previous_valid_until   timestamptz,
  new_valid_until        timestamptz,
  decision               varchar(32),
  decided_by             uuid,
  decided_at             timestamptz,
  decision_reason        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS trade_renewals_tenant_idx ON trade.trade_renewals (tenant_id);
CREATE INDEX IF NOT EXISTS trade_renewals_status_idx ON trade.trade_renewals (tenant_id, status);
CREATE INDEX IF NOT EXISTS trade_renewals_licence_idx ON trade.trade_renewals (licence_id);

ALTER TABLE trade.trade_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade.trade_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trade_renewals' AND schemaname = 'trade' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON trade.trade_renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
