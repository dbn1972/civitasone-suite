-- Purpose: Create shop-service schema and initial tables.
-- Schema: shop (single schema per works-service pattern for same-DB services)
-- Tables: applications, scrutiny_records, permits, permit_actions, renewals; plus _outbox/_inbox.
-- NOTE: table names are NOT prefixed with "shop_" (deviates from the fleet's
-- documented {service}_{entity_plural} convention — see MASTER-PROMPT-SEC5.md
-- naming table vs. vendor's vendor_registrations style). Matches the actual
-- exports in services/shop-service/src/modules/*/schema.ts as-is; flagged for
-- the shop-service deep-dive, not changed here since it is not a functional bug
-- (schema-qualified names are unambiguous) and renaming is a behavioural no-op
-- best judged alongside the rest of shop's audit.
-- NOTE 2: permit_actions has no updated_at/created_by/updated_by (append-only
-- action log; performed_by substitutes) — deviates from the "mandatory entity
-- fields" rule in MASTER-PROMPT-SEC5.md. Matches schema.ts as written; flagged
-- for the shop-service deep-dive to judge as by-design vs. a gap.
-- RLS: FORCE RLS + tenant_id isolation on all domain tables.
-- Rollback: DROP SCHEMA shop CASCADE;

SET lock_timeout = '5s';

-- ===================== SCHEMAS =====================
CREATE SCHEMA IF NOT EXISTS shop;
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_outbox_unpublished
  ON _outbox.messages (created_at)
  WHERE published_at IS NULL;

-- ===================== shop.applications =====================
CREATE TABLE IF NOT EXISTS shop.applications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  application_number      varchar(64) NOT NULL UNIQUE,
  status                  varchar(32) NOT NULL DEFAULT 'draft',
  applicant_id            uuid NOT NULL,
  establishment_name      varchar(256) NOT NULL,
  establishment_type      varchar(64) NOT NULL,
  owner_name              varchar(256) NOT NULL,
  owner_type              varchar(32) NOT NULL,
  premises_address        jsonb NOT NULL,
  premises_property_id    uuid,
  activity_description    text,
  activity_category       varchar(64) NOT NULL,
  employee_count          integer,
  capacity_details        jsonb,
  documents               jsonb NOT NULL DEFAULT '[]',
  fee_amount_minor        bigint,
  fee_currency            varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid                boolean NOT NULL DEFAULT false,
  fee_transaction_id      varchar(128),
  submitted_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS shop_applications_tenant_idx ON shop.applications (tenant_id);
CREATE INDEX IF NOT EXISTS shop_applications_status_idx ON shop.applications (tenant_id, status);

ALTER TABLE shop.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'applications' AND schemaname = 'shop' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON shop.applications
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== shop.scrutiny_records =====================
CREATE TABLE IF NOT EXISTS shop.scrutiny_records (
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

CREATE INDEX IF NOT EXISTS shop_scrutiny_records_tenant_idx ON shop.scrutiny_records (tenant_id);
CREATE INDEX IF NOT EXISTS shop_scrutiny_records_application_idx ON shop.scrutiny_records (application_id);

ALTER TABLE shop.scrutiny_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.scrutiny_records FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_records' AND schemaname = 'shop' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON shop.scrutiny_records
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== shop.permits =====================
CREATE TABLE IF NOT EXISTS shop.permits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  application_id         uuid NOT NULL,
  permit_number          varchar(64) NOT NULL UNIQUE,
  establishment_name     varchar(256) NOT NULL,
  permit_status          varchar(32) NOT NULL DEFAULT 'active',
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

CREATE INDEX IF NOT EXISTS shop_permits_tenant_idx ON shop.permits (tenant_id);
CREATE INDEX IF NOT EXISTS shop_permits_status_idx ON shop.permits (tenant_id, permit_status);
CREATE INDEX IF NOT EXISTS shop_permits_application_idx ON shop.permits (application_id);

ALTER TABLE shop.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.permits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permits' AND schemaname = 'shop' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON shop.permits
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== shop.permit_actions =====================
-- NOTE: no updated_at/created_by/updated_by — see file header.
CREATE TABLE IF NOT EXISTS shop.permit_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  permit_id         uuid NOT NULL,
  action_type       varchar(32) NOT NULL,
  reason            text,
  effective_from    timestamptz,
  notice_details    jsonb,
  performed_by      uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS shop_permit_actions_tenant_idx ON shop.permit_actions (tenant_id);
CREATE INDEX IF NOT EXISTS shop_permit_actions_permit_idx ON shop.permit_actions (permit_id);

ALTER TABLE shop.permit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.permit_actions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_actions' AND schemaname = 'shop' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON shop.permit_actions
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;

-- ===================== shop.renewals =====================
CREATE TABLE IF NOT EXISTS shop.renewals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  permit_id              uuid NOT NULL,
  renewal_type           varchar(32) NOT NULL,
  status                 varchar(32) NOT NULL DEFAULT 'submitted',
  details                jsonb,
  fee_amount_minor       bigint,
  fee_currency           varchar(3) NOT NULL DEFAULT 'INR',
  fee_paid               boolean NOT NULL DEFAULT false,
  previous_valid_until   timestamptz,
  new_valid_until        timestamptz,
  decided_by             uuid,
  decided_at             timestamptz,
  decision_reason        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_by             uuid NOT NULL,
  version                integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS shop_renewals_tenant_idx ON shop.renewals (tenant_id);
CREATE INDEX IF NOT EXISTS shop_renewals_status_idx ON shop.renewals (tenant_id, status);
CREATE INDEX IF NOT EXISTS shop_renewals_permit_idx ON shop.renewals (permit_id);

ALTER TABLE shop.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop.renewals FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'renewals' AND schemaname = 'shop' AND policyname = 'tenant_isolation') THEN
    EXECUTE $pol$
      CREATE POLICY tenant_isolation ON shop.renewals
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $pol$;
  END IF;
END $$;
