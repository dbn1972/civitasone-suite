-- SVC-095: RTI application, first/second appeal, transfer, third-party
--   consultation, §8/§9 exemptions, fee, disposal, and §4 disclosure log.
-- Additive, idempotent (CREATE ... IF NOT EXISTS). Every table carries
--   tenant_id + ENABLE/FORCE RLS + tenant_isolation policy, mirroring
--   0010_rls_full_tenant_isolation.sql (current_tenant_id()).
-- Rollback: DROP SCHEMA rti CASCADE;
-- Affected services: legal-service only.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS rti;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── rti.rti_applications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  application_no  text        NOT NULL,
  applicant_name  text        NOT NULL,
  applicant_addr  text,
  subject         text        NOT NULL,
  request_text    text        NOT NULL,
  pio_ref         text,
  life_or_liberty boolean     NOT NULL DEFAULT false,
  third_party     boolean     NOT NULL DEFAULT false,
  fee_paid        numeric(12,2) NOT NULL DEFAULT 0,
  additional_fee  numeric(12,2) NOT NULL DEFAULT 0,
  received_at     timestamptz NOT NULL DEFAULT now(),
  deadline_at     timestamptz NOT NULL,
  status          varchar(24) NOT NULL DEFAULT 'received',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  CONSTRAINT rti_applications_status_check
    CHECK (status IN ('received','transferred','third_party_consult','responded','rejected','closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rti_applications_no
  ON rti.rti_applications (tenant_id, application_no);
CREATE INDEX IF NOT EXISTS idx_rti_applications_tenant
  ON rti.rti_applications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rti_applications_deadline
  ON rti.rti_applications (tenant_id, deadline_at);

-- ── rti.rti_transfers ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_transfers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  from_authority text        NOT NULL,
  to_authority   text        NOT NULL,
  reason         text,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rti_transfers_app ON rti.rti_transfers (tenant_id, application_id);

-- ── rti.rti_third_party_consults ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_third_party_consults (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  third_party    text        NOT NULL,
  notice_at      timestamptz NOT NULL DEFAULT now(),
  response       text,
  consented      boolean,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rti_consults_app ON rti.rti_third_party_consults (tenant_id, application_id);

-- ── rti.rti_exemptions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_exemptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  section        varchar(16) NOT NULL,
  justification  text        NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rti_exemptions_app ON rti.rti_exemptions (tenant_id, application_id);

-- ── rti.rti_responses ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_responses (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid        NOT NULL,
  decision       varchar(16) NOT NULL,
  response_text  text        NOT NULL,
  responded_at   timestamptz NOT NULL DEFAULT now(),
  responded_by   uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rti_responses_decision_check CHECK (decision IN ('provided','partial','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_rti_responses_app ON rti.rti_responses (tenant_id, application_id);

-- ── rti.rti_appeals (maker-checker on the order) ────────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_appeals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  application_id      uuid        NOT NULL,
  tier                varchar(8)  NOT NULL,
  appellate_authority text        NOT NULL,
  grounds             text        NOT NULL,
  filed_at            timestamptz NOT NULL DEFAULT now(),
  deadline_at         timestamptz NOT NULL,
  order_status        varchar(16) NOT NULL DEFAULT 'pending',
  order_text          text,
  filed_by            uuid        NOT NULL,
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1,
  CONSTRAINT rti_appeals_tier_check CHECK (tier IN ('first','second')),
  CONSTRAINT rti_appeals_order_check CHECK (order_status IN ('pending','allowed','rejected','partly_allowed'))
);
CREATE INDEX IF NOT EXISTS idx_rti_appeals_app ON rti.rti_appeals (tenant_id, application_id);

-- ── rti.rti_disclosure_log (§4 proactive disclosure) ────────────────────────
CREATE TABLE IF NOT EXISTS rti.rti_disclosure_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  application_id uuid,
  category       varchar(32) NOT NULL,
  description    text        NOT NULL,
  disclosed_at   timestamptz NOT NULL DEFAULT now(),
  disclosed_by   uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rti_disclosure_tenant ON rti.rti_disclosure_log (tenant_id);

-- ── RLS: tenant isolation (ENABLE + FORCE + policy) on every table ──────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rti.rti_applications','rti.rti_transfers','rti.rti_third_party_consults',
    'rti.rti_exemptions','rti.rti_responses','rti.rti_appeals','rti.rti_disclosure_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
