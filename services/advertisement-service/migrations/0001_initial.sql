-- Purpose: Create advertisement-service schemas and initial tables.
-- Schemas: adv_applications, adv_approvals, adv_permits; plus _outbox/_inbox.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA adv_applications CASCADE; DROP SCHEMA adv_approvals CASCADE; DROP SCHEMA adv_permits CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS adv_applications;
CREATE SCHEMA IF NOT EXISTS adv_approvals;
CREATE SCHEMA IF NOT EXISTS adv_permits;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_adv_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== adv_applications.adv_applications =====================
CREATE TABLE IF NOT EXISTS adv_applications.adv_applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  application_number   varchar(64) NOT NULL UNIQUE,
  status               varchar(32) NOT NULL DEFAULT 'draft',
  advertiser_name      text NOT NULL,
  advertiser_org       text NOT NULL,
  advertisement_type   varchar(32) NOT NULL,
  location             jsonb NOT NULL,
  dimensions           jsonb NOT NULL,
  structural_details   jsonb,
  creative             text,
  documents            jsonb NOT NULL DEFAULT '[]',
  fee_minor            bigint,
  currency             varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid             boolean NOT NULL DEFAULT false,
  submitted_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS adv_apps_tenant_idx ON adv_applications.adv_applications (tenant_id);
CREATE INDEX IF NOT EXISTS adv_apps_status_idx ON adv_applications.adv_applications (tenant_id, status);

ALTER TABLE adv_applications.adv_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_applications.adv_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adv_applications' AND schemaname = 'adv_applications' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON adv_applications.adv_applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== adv_approvals.adv_scrutiny_records =====================
CREATE TABLE IF NOT EXISTS adv_approvals.adv_scrutiny_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  application_id  uuid NOT NULL,
  scrutiny_type   varchar(32) NOT NULL,
  status          varchar(32) NOT NULL DEFAULT 'pending',
  findings        jsonb,
  officer_id      uuid NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL,
  updated_by      uuid NOT NULL,
  version         integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS adv_scrutiny_tenant_idx ON adv_approvals.adv_scrutiny_records (tenant_id);

ALTER TABLE adv_approvals.adv_scrutiny_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_approvals.adv_scrutiny_records FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adv_scrutiny_records' AND schemaname = 'adv_approvals' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON adv_approvals.adv_scrutiny_records
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== adv_permits.adv_permits =====================
CREATE TABLE IF NOT EXISTS adv_permits.adv_permits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  permit_number        varchar(64) NOT NULL UNIQUE,
  application_id       uuid NOT NULL,
  status               varchar(32) NOT NULL DEFAULT 'issued',
  issued_at            timestamptz,
  valid_from           date,
  valid_until          date,
  location             jsonb NOT NULL,
  advertisement_type   varchar(32) NOT NULL,
  verification_code    varchar(32) NOT NULL UNIQUE,
  suspended_at         timestamptz,
  suspension_reason    varchar(512),
  cancelled_at         timestamptz,
  cancellation_reason  varchar(512),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS adv_permits_tenant_idx ON adv_permits.adv_permits (tenant_id);

ALTER TABLE adv_permits.adv_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_permits.adv_permits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adv_permits' AND schemaname = 'adv_permits' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON adv_permits.adv_permits
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== adv_permits.adv_renewals =====================
CREATE TABLE IF NOT EXISTS adv_permits.adv_renewals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  permit_id            uuid NOT NULL,
  renewal_type         varchar(32) NOT NULL,
  status               varchar(32) NOT NULL DEFAULT 'pending',
  fee_minor            bigint,
  currency             varchar(3) NOT NULL DEFAULT 'INR',
  previous_valid_until date,
  new_valid_until      date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS adv_renewals_tenant_idx ON adv_permits.adv_renewals (tenant_id);

ALTER TABLE adv_permits.adv_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adv_permits.adv_renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adv_renewals' AND schemaname = 'adv_permits' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON adv_permits.adv_renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
