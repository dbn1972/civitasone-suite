-- citizen-service migration 0016 — SVC-081/082/084/089 partial-capability completion.
-- Additive only. Every new table carries tenant_id + RLS (ENABLE + FORCE + tenant_isolation)
-- mirroring 0015_service_gaps.sql (portal.current_tenant_id()).
-- Idempotent (IF NOT EXISTS) to match migrate-all.mjs semantics.
--
-- The app connects as citizen_svc; migrate-all runs as civitas_admin. New schemas
-- are created AUTHORIZATION citizen_svc and (below) ownership is reassigned to
-- citizen_svc so the service role has full DML, mirroring 0015.

CREATE SCHEMA IF NOT EXISTS catalogue AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS documents AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS appeal    AUTHORIZATION citizen_svc;

-- ============================================================================
-- SVC-081  Government service catalogue — versioned service-definition registry
-- ============================================================================
-- One row per (tenant, service_key, version). Publish freezes the row
-- (immutable); a new revision is a NEW row (version+1) in 'draft'. Maker-checker:
-- submitted_by (maker) must differ from published_by (checker).
CREATE TABLE IF NOT EXISTS catalogue.service_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  service_key        varchar(64) NOT NULL,     -- stable business key across versions
  service_id         uuid,                     -- optional link to portal.citizen_services
  name               text NOT NULL,
  owner_department   text,
  version            integer NOT NULL DEFAULT 1,
  status             varchar(16) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  eligibility_rule_set_id uuid,                -- link to SVC-083 rule set
  fee_schedule_id    uuid,                     -- link to SVC-085 fee schedule
  issuance_type      varchar(48),              -- link to SVC-086 cert type
  required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,  -- checklist [{docType,label,mandatory}]
  sla_days           integer,
  channels           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ['portal','counter','mobile','assisted']
  forms              jsonb NOT NULL DEFAULT '[]'::jsonb,
  outputs            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- maker-checker provenance
  submitted_by       uuid,
  published_by       uuid,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  row_version        integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_svc_def_key_version
  ON catalogue.service_definitions (tenant_id, service_key, version);
CREATE INDEX IF NOT EXISTS ix_svc_def_tenant_status
  ON catalogue.service_definitions (tenant_id, status);

-- ============================================================================
-- SVC-082  Online application & assisted-service intake — draft + channel + ack
-- ============================================================================
-- Draft save/resume workspace. On submit a draft is frozen and an application is
-- created directly (tracking number + acknowledgement). channel attribution:
-- portal | counter | mobile | assisted. assisted_by is the operator acting
-- on-behalf-of (ASSISTED entry).
CREATE TABLE IF NOT EXISTS application.application_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  citizen_id     uuid NOT NULL,
  service_id     uuid NOT NULL,
  service_key    varchar(64),
  channel        varchar(16) NOT NULL DEFAULT 'portal'
                   CHECK (channel IN ('portal','counter','mobile','assisted')),
  assisted_by    uuid,                          -- operator-on-behalf-of (assisted/counter)
  form_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         varchar(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','abandoned')),
  application_id uuid,                           -- set on submit
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  row_version    integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_app_drafts_tenant_citizen
  ON application.application_drafts (tenant_id, citizen_id);

-- Acknowledgement / channel columns on the existing applications table (additive).
ALTER TABLE application.citizen_applications
  ADD COLUMN IF NOT EXISTS tracking_no  text,
  ADD COLUMN IF NOT EXISTS channel      varchar(16) NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS assisted_by  uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_citizen_app_tracking_no
  ON application.citizen_applications (tenant_id, tracking_no) WHERE tracking_no IS NOT NULL;

-- ============================================================================
-- SVC-084  Document submission & verification
-- ============================================================================
-- Upload intake + DigiLocker-style fetch intake. authenticity/verification
-- status, deficiency memo, resubmission cycle (supersedes_id links a resubmission
-- to the deficient submission it replaces).
CREATE TABLE IF NOT EXISTS documents.submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  application_id      uuid,
  citizen_id          uuid,
  service_id          uuid,
  doc_type            varchar(64) NOT NULL,
  source              varchar(16) NOT NULL DEFAULT 'upload'
                        CHECK (source IN ('upload','digilocker')),
  storage_ref         text,                       -- presigned/object ref (never binary in DB)
  digilocker_ref      text,                       -- provider document uri, when fetched
  provider_status     varchar(24),                -- honest adapter status (e.g. provider_unconfigured)
  status              varchar(16) NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received','verified','rejected','deficient','superseded')),
  verification_status varchar(16) NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','verified','failed')),
  authenticity        varchar(16) NOT NULL DEFAULT 'unverified'
                        CHECK (authenticity IN ('unverified','self_attested','source_verified')),
  deficiency_reason   text,
  supersedes_id       uuid,                       -- resubmission → prior deficient submission
  verified_by         uuid,
  verified_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  row_version         integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_doc_submissions_tenant_app
  ON documents.submissions (tenant_id, application_id);
CREATE INDEX IF NOT EXISTS ix_doc_submissions_tenant_status
  ON documents.submissions (tenant_id, status);

-- ============================================================================
-- SVC-089  Appeal, review & revision
-- ============================================================================
-- An appeal against an application/decision. Filing-window validated at the app
-- layer against decision_date + window. Order is maker-checker: prepared_by
-- (maker) drafts the order, decided_by (checker, must differ) issues it.
CREATE TABLE IF NOT EXISTS appeal.appeals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  application_id      uuid,
  decision_ref        text,
  citizen_id          uuid,
  appeal_type         varchar(16) NOT NULL DEFAULT 'appeal'
                        CHECK (appeal_type IN ('appeal','review','revision')),
  grounds             text NOT NULL,
  decision_date       date,
  filing_deadline     date,
  status              varchar(16) NOT NULL DEFAULT 'filed'
                        CHECK (status IN ('filed','assigned','hearing','decided','remanded','closed')),
  appellate_authority_id uuid,
  records_transferred boolean NOT NULL DEFAULT false,
  records_transferred_at timestamptz,
  -- order maker-checker
  order_type          varchar(16)
                        CHECK (order_type IN ('upheld','overturned','modified','remanded')),
  order_note          text,
  remand_to           uuid,
  outcome             varchar(16),
  prepared_by         uuid,                       -- maker: drafted the order
  prepared_at         timestamptz,
  decided_by          uuid,                       -- checker: issued the order (differs from maker)
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  updated_by          uuid NOT NULL,
  row_version         integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_appeals_tenant_status
  ON appeal.appeals (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_appeals_tenant_app
  ON appeal.appeals (tenant_id, application_id);

CREATE TABLE IF NOT EXISTS appeal.hearings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  appeal_id     uuid NOT NULL,
  scheduled_at  timestamptz,
  held_at       timestamptz,
  mode          varchar(16) NOT NULL DEFAULT 'in_person'
                  CHECK (mode IN ('in_person','video','written')),
  record        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  row_version   integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_hearings_appeal
  ON appeal.hearings (appeal_id);

-- ============================================================================
-- Row Level Security — mirror 0007/0015 (portal.current_tenant_id()).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalogue.service_definitions',
    'application.application_drafts',
    'documents.submissions',
    'appeal.appeals','appeal.hearings'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = portal.current_tenant_id())', t);
  END LOOP;
END $$;

-- ============================================================================
-- Ownership → citizen_svc (idempotent; harmless when already owned).
-- ============================================================================
DO $$
DECLARE s text; r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_svc') THEN
    FOREACH s IN ARRAY ARRAY['catalogue','documents','appeal'] LOOP
      EXECUTE format('ALTER SCHEMA %I OWNER TO citizen_svc', s);
    END LOOP;
    FOR r IN
      SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname IN ('catalogue','documents','appeal')
    LOOP
      EXECUTE format('ALTER TABLE %I.%I OWNER TO citizen_svc', r.schemaname, r.tablename);
    END LOOP;
  END IF;
END $$;
