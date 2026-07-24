-- citizen-service migration 0015 — SVC-083/085/086/090 capability gaps.
-- Additive only. Every table carries tenant_id + RLS (ENABLE + FORCE + tenant_isolation)
-- mirroring 0007_rls_tenant_isolation.sql (portal.current_tenant_id()).
-- Idempotent (IF NOT EXISTS) to match migrate-all.mjs semantics.

-- The app connects as citizen_svc; existing schemas (portal, application, …) are
-- owned by that role. migrate-all runs as civitas_admin, so create AUTHORIZATION
-- citizen_svc and (below) reassign ownership of every object to citizen_svc so
-- the service role has full DML access — mirroring the existing schemas.
CREATE SCHEMA IF NOT EXISTS eligibility AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS fee AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS issuance AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS discovery AUTHORIZATION citizen_svc;

-- ============================================================================
-- SVC-083  Eligibility & entitlement determination
-- ============================================================================
-- Versioned, maker-checker rule sets. `rules` is an immutable-once-published
-- JSON array of {id, attribute, op, value, effect}. A published row is frozen;
-- a new revision is a NEW row (version+1) in "draft".
CREATE TABLE IF NOT EXISTS eligibility.rule_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  service_id    uuid NOT NULL,
  name          text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  status        varchar(16) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  rules         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- maker-checker provenance
  submitted_by  uuid,                 -- maker who requested publication
  published_by  uuid,                 -- checker who approved (must differ)
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  row_version   integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_sets_service_version
  ON eligibility.rule_sets (tenant_id, service_id, version);
CREATE INDEX IF NOT EXISTS ix_rule_sets_tenant_service
  ON eligibility.rule_sets (tenant_id, service_id);

-- One row per evaluation of an application/subject against a rule set.
-- outcome: eligible | not_eligible | refer_manual. Manual-review queue is the
-- subset where review_status='pending'.
CREATE TABLE IF NOT EXISTS eligibility.evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  rule_set_id    uuid NOT NULL,
  application_id uuid,
  subject_ref    uuid,               -- citizen id or arbitrary subject
  subject        jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome        varchar(16) NOT NULL
                   CHECK (outcome IN ('eligible','not_eligible','refer_manual')),
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status  varchar(16) NOT NULL DEFAULT 'none'
                   CHECK (review_status IN ('none','pending','decided')),
  review_decision varchar(16)
                   CHECK (review_decision IN ('eligible','not_eligible')),
  review_note    text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  row_version    integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_evaluations_tenant_queue
  ON eligibility.evaluations (tenant_id, review_status);
CREATE INDEX IF NOT EXISTS ix_evaluations_rule_set
  ON eligibility.evaluations (rule_set_id);

-- ============================================================================
-- SVC-085  Service fee & payment handling
-- ============================================================================
CREATE TABLE IF NOT EXISTS fee.schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  service_id     uuid NOT NULL,
  name           text NOT NULL,
  base_amount    numeric(14,2) NOT NULL DEFAULT 0,
  currency       varchar(3) NOT NULL DEFAULT 'INR',
  exemptions     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id,attribute,op,value,kind,value2}]
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  row_version    integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_fee_schedules_tenant_service
  ON fee.schedules (tenant_id, service_id);

-- A payment against an application. Online path is env-gated: with no gateway
-- creds it stays 'pending' (honest, NOT fake success). Offline is recorded.
CREATE TABLE IF NOT EXISTS fee.payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  application_id       uuid NOT NULL,
  schedule_id          uuid,
  citizen_id           uuid,
  amount               numeric(14,2) NOT NULL,
  currency             varchar(3) NOT NULL DEFAULT 'INR',
  exemption_applied    text,
  method               varchar(16) NOT NULL
                         CHECK (method IN ('online','offline')),
  status               varchar(24) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','paid','offline_recorded','refund_pending','refunded','failed')),
  gateway_ref          text,
  receipt_no           text,
  receipt_issued_at    timestamptz,
  reconciliation_status varchar(16) NOT NULL DEFAULT 'unreconciled'
                         CHECK (reconciliation_status IN ('unreconciled','reconciled','disputed')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  row_version          integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt_no
  ON fee.payments (tenant_id, receipt_no) WHERE receipt_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payments_tenant_app
  ON fee.payments (tenant_id, application_id);

-- Maker-checker refund. requested_by (maker) must differ from approved_by (checker).
CREATE TABLE IF NOT EXISTS fee.refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  payment_id    uuid NOT NULL,
  amount        numeric(14,2) NOT NULL,
  reason        text,
  status        varchar(16) NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','rejected')),
  requested_by  uuid NOT NULL,
  approved_by   uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL,
  updated_by    uuid NOT NULL,
  row_version   integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_refunds_tenant_payment
  ON fee.refunds (tenant_id, payment_id);

-- ============================================================================
-- SVC-086  Certificate / licence / permit issuance
-- ============================================================================
-- Gapless per (tenant, type, year) sequence. Incremented under row lock.
CREATE TABLE IF NOT EXISTS issuance.counters (
  tenant_id   uuid NOT NULL,
  cert_type   varchar(48) NOT NULL,
  year        integer NOT NULL,
  last_seq    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, cert_type, year)
);

CREATE TABLE IF NOT EXISTS issuance.certificates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  application_id uuid,
  cert_type      varchar(48) NOT NULL,
  cert_no        text,
  seq_year       integer,
  status         varchar(16) NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','active','amended','renewed','cancelled','revoked','expired')),
  subject        jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash   text,
  signature      text,
  verify_token   text,
  valid_from     date,
  valid_to       date,
  -- maker-checker: requested_by (maker) differs from approved_by (checker)
  requested_by   uuid NOT NULL,
  approved_by    uuid,
  issued_at      timestamptz,
  superseded_by  uuid,             -- points to the renewal/amendment successor
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  row_version    integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_no
  ON issuance.certificates (tenant_id, cert_no) WHERE cert_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cert_verify_token
  ON issuance.certificates (verify_token) WHERE verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cert_tenant_app
  ON issuance.certificates (tenant_id, application_id);

CREATE TABLE IF NOT EXISTS issuance.certificate_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  certificate_id uuid NOT NULL,
  event_type     varchar(24) NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  row_version    integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_cert_events_cert
  ON issuance.certificate_events (certificate_id);

-- ============================================================================
-- SVC-090  Proactive service & benefit discovery
-- ============================================================================
-- Consent is REQUIRED and tracked. No discovery runs without an active grant.
CREATE TABLE IF NOT EXISTS discovery.consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  citizen_id   uuid NOT NULL,
  scope        varchar(48) NOT NULL DEFAULT 'benefit_discovery',
  granted      boolean NOT NULL DEFAULT true,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  row_version  integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_consents_tenant_citizen
  ON discovery.consents (tenant_id, citizen_id, scope);

CREATE TABLE IF NOT EXISTS discovery.matches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  citizen_id   uuid NOT NULL,
  service_id   uuid NOT NULL,
  rule_set_id  uuid,
  outcome      varchar(16) NOT NULL,
  reasons      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notified     boolean NOT NULL DEFAULT false,
  enrolled_application_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL,
  updated_by   uuid NOT NULL,
  row_version  integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_matches_tenant_citizen
  ON discovery.matches (tenant_id, citizen_id);

-- ============================================================================
-- Row Level Security — mirror 0007 (portal.current_tenant_id()).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'eligibility.rule_sets','eligibility.evaluations',
    'fee.schedules','fee.payments','fee.refunds',
    'issuance.counters','issuance.certificates','issuance.certificate_events',
    'discovery.consents','discovery.matches'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = portal.current_tenant_id())', t);
  END LOOP;
END $$;

-- ============================================================================
-- Ownership → citizen_svc (idempotent; harmless when already owned).
-- Runs as civitas_admin (superuser); gives the service role full access and
-- matches how portal/application schemas are owned.
-- ============================================================================
DO $$
DECLARE s text; r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citizen_svc') THEN
    FOREACH s IN ARRAY ARRAY['eligibility','fee','issuance','discovery'] LOOP
      EXECUTE format('ALTER SCHEMA %I OWNER TO citizen_svc', s);
    END LOOP;
    FOR r IN
      SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname IN ('eligibility','fee','issuance','discovery')
    LOOP
      EXECUTE format('ALTER TABLE %I.%I OWNER TO citizen_svc', r.schemaname, r.tablename);
    END LOOP;
  END IF;
END $$;
