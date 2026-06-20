-- legal-service initial migration
-- Run as legal_svc on civitas_legal

CREATE SCHEMA IF NOT EXISTS cases;
CREATE SCHEMA IF NOT EXISTS hearings;
CREATE SCHEMA IF NOT EXISTS notices;
CREATE SCHEMA IF NOT EXISTS contracts;
CREATE SCHEMA IF NOT EXISTS settlements;

-- ── cases module ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cases.legal_case_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS cases.legal_cases (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  case_no       text        NOT NULL,
  title         text        NOT NULL,
  court         text        NOT NULL,
  subject       text,
  case_type_id  uuid,
  petitioner    text,
  counsel_ref   text,
  status        varchar(24) NOT NULL DEFAULT 'pending',
  next_date     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, case_no),
  CONSTRAINT chk_legal_case_status CHECK (status IN ('pending','disposed','appealed','stayed','settled'))
);

CREATE TABLE IF NOT EXISTS cases.legal_parties (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  case_id     uuid        NOT NULL,
  name        text        NOT NULL,
  role        varchar(32) NOT NULL DEFAULT 'respondent',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_legal_cases_tenant_status ON cases.legal_cases (tenant_id, status);

-- ── hearings module ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hearings.legal_hearings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  case_id        uuid        NOT NULL,
  hearing_date   date        NOT NULL,
  court          text        NOT NULL,
  purpose        text,
  status         varchar(24) NOT NULL DEFAULT 'scheduled',
  next_date      date,
  previous_date  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hearings.legal_orders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  case_id     uuid        NOT NULL,
  order_type  varchar(32) NOT NULL,
  direction   text,
  dept_ref    text,
  summary     text        NOT NULL,
  order_date  date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_legal_hearings_case ON hearings.legal_hearings (case_id, hearing_date DESC);

-- ── notices module ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notices.legal_notices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  notice_no   text        NOT NULL,
  subject     text        NOT NULL,
  party_ref   text        NOT NULL,
  direction   varchar(16) NOT NULL,
  status      varchar(24) NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NOT NULL,
  updated_by  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, notice_no),
  CONSTRAINT chk_legal_notice_direction CHECK (direction IN ('sent','received'))
);

CREATE TABLE IF NOT EXISTS notices.legal_notice_responses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  notice_id     uuid        NOT NULL,
  response_body text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

-- ── contracts module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contracts.legal_contract_reviews (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  contract_ref  text        NOT NULL,
  subject       text        NOT NULL,
  value_minor   bigint      NOT NULL DEFAULT 0,
  currency      char(3)     NOT NULL DEFAULT 'INR',
  status        varchar(24) NOT NULL DEFAULT 'pending',
  cleared_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,
  updated_by    uuid        NOT NULL,
  version       integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contracts.legal_clearances (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  review_id       uuid        NOT NULL,
  clearance_type  varchar(32) NOT NULL,
  notes           text,
  cleared_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

-- ── settlements module ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settlements.legal_settlements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  case_id        uuid,
  settlement_no  text        NOT NULL,
  amount_minor   bigint      NOT NULL DEFAULT 0,
  currency       char(3)     NOT NULL DEFAULT 'INR',
  status         varchar(24) NOT NULL DEFAULT 'draft',
  settled_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_by     uuid        NOT NULL,
  version        integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, settlement_no)
);

CREATE TABLE IF NOT EXISTS settlements.legal_lok_adalat (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  settlement_id    uuid        NOT NULL,
  lok_adalat_date  date        NOT NULL,
  venue            text        NOT NULL,
  outcome          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

-- ── outbox / inbox ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _outbox.messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic            varchar(128) NOT NULL,
  event_type       varchar(128) NOT NULL,
  tenant_id        uuid        NOT NULL,
  actor_id         uuid        NOT NULL,
  correlation_id   varchar(64) NOT NULL,
  payload          jsonb       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz
);

CREATE TABLE IF NOT EXISTS _inbox.processed (
  message_id       uuid        PRIMARY KEY,
  processed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON _outbox.messages (created_at) WHERE published_at IS NULL;
