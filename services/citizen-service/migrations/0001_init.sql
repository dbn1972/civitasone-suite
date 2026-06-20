-- citizen-service initial migration
-- Applied with citizen_svc role on civitas_citizen.
-- L2 schemas: portal, application, grievance, rti, helpdesk, analytics
-- Outbox/inbox schemas pre-created by DB bootstrap.

CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS application;
CREATE SCHEMA IF NOT EXISTS grievance;
CREATE SCHEMA IF NOT EXISTS rti;
CREATE SCHEMA IF NOT EXISTS helpdesk;
CREATE SCHEMA IF NOT EXISTS analytics;

-- ── portal module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.citizen_profiles (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  name               text        NOT NULL,
  email              text,
  mobile             varchar(16),
  digilocker_token   text,                                    -- DigiLocker link only; no Aadhaar stored
  address            text,
  ward               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS portal.citizen_service_categories (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  name               text        NOT NULL,
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS portal.citizen_services (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  category_id        uuid        NOT NULL,
  name               text        NOT NULL,
  description        text,
  required_docs      jsonb       NOT NULL DEFAULT '[]',
  department_ref     text,                                    -- tenant_org_units:UUID (opaque)
  active             boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── application module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS application.citizen_applications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  citizen_id         uuid        NOT NULL,
  service_id         uuid        NOT NULL,
  ref_no             text        NOT NULL,
  status             varchar(24) NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','under_review','pending_docs','approved','rejected','issued')),
  deadline           date,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, ref_no)
);

CREATE TABLE IF NOT EXISTS application.citizen_app_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  application_id     uuid        NOT NULL,
  doc_type           varchar(64) NOT NULL,
  doc_url            text        NOT NULL,                    -- S3 pre-signed or DigiLocker URL only
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS application.citizen_status_history (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  application_id     uuid        NOT NULL,
  from_status        varchar(24),
  to_status          varchar(24) NOT NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── grievance module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grievance.citizen_grievances (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  citizen_id         uuid        NOT NULL,
  category           text        NOT NULL,
  subject            text        NOT NULL,
  description        text        NOT NULL,
  priority           varchar(16) NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high','urgent')),
  department_ref     text,
  assigned_to        uuid,
  status             varchar(24) NOT NULL DEFAULT 'registered'
                     CHECK (status IN ('registered','assigned','in_progress','resolved','closed','reopened')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS grievance.citizen_grievance_actions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  grievance_id       uuid        NOT NULL,
  officer_id         uuid        NOT NULL,
  action_type        varchar(32) NOT NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS grievance.citizen_escalations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  grievance_id       uuid        NOT NULL,
  level              integer     NOT NULL DEFAULT 1,
  reason             text        NOT NULL,
  escalated_to       uuid,
  status             varchar(24) NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── rti module ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rti.citizen_rti_requests (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  citizen_id         uuid,
  rti_no             text        NOT NULL,
  subject            text        NOT NULL,
  description        text        NOT NULL,
  cpio_ref           uuid        NOT NULL,
  deadline           date        NOT NULL,                    -- created_at + 30 days (RTI Act 2005 s.7)
  status             varchar(24) NOT NULL DEFAULT 'filed',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, rti_no)
);

CREATE TABLE IF NOT EXISTS rti.citizen_rti_responses (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  rti_id             uuid        NOT NULL,
  response_url       text        NOT NULL,
  responded_by       uuid        NOT NULL,
  responded_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rti.citizen_rti_appeals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  rti_id             uuid        NOT NULL,
  appeal_type        varchar(16) NOT NULL DEFAULT 'first',    -- first|cic
  grounds            text        NOT NULL,
  status             varchar(24) NOT NULL DEFAULT 'filed',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── helpdesk module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk.citizen_tickets (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  citizen_id         uuid        NOT NULL,
  subject            text        NOT NULL,
  description        text        NOT NULL,
  status             varchar(24) NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS helpdesk.citizen_ticket_notes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  ticket_id          uuid        NOT NULL,
  author_id          uuid        NOT NULL,
  body               text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

-- ── analytics module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics.citizen_sla_configs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  service_type       varchar(64) NOT NULL,
  max_days           integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, service_type)
);

CREATE TABLE IF NOT EXISTS analytics.citizen_delivery_metrics (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  service_type       varchar(64) NOT NULL,
  department_ref     text,
  pending_count      integer     NOT NULL DEFAULT 0,
  resolved_count     integer     NOT NULL DEFAULT 0,
  avg_days           numeric(8,2) NOT NULL DEFAULT 0,
  period_date        date        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_citizen_applications_tenant_citizen ON application.citizen_applications (tenant_id, citizen_id);
CREATE INDEX IF NOT EXISTS idx_citizen_grievances_tenant_citizen ON grievance.citizen_grievances (tenant_id, citizen_id);
CREATE INDEX IF NOT EXISTS idx_citizen_grievances_status ON grievance.citizen_grievances (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_citizen_rti_deadline ON rti.citizen_rti_requests (tenant_id, deadline);

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

