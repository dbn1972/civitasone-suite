-- procurement-service: add RFQ and Tender tables

CREATE SCHEMA IF NOT EXISTS rfq;
CREATE SCHEMA IF NOT EXISTS tender;

-- ── rfq module ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rfq.procurement_rfqs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  rfq_no             text        NOT NULL,
  title              text        NOT NULL,
  description        text,
  indent_ref         text,                                   -- opaque "procurement_indent:UUID"
  vendors_invited    integer     NOT NULL DEFAULT 0,
  responses_received integer     NOT NULL DEFAULT 0,
  closing_date       date        NOT NULL,
  status             varchar(16) NOT NULL DEFAULT 'draft',   -- draft|issued|closed|cancelled|awarded
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, rfq_no)
);

CREATE TABLE IF NOT EXISTS rfq.procurement_rfq_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id     uuid        NOT NULL,
  tenant_id  uuid        NOT NULL,
  item_name  text        NOT NULL,
  quantity   integer     NOT NULL DEFAULT 1,
  unit       varchar(32) NOT NULL DEFAULT 'nos',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL,
  updated_by uuid        NOT NULL,
  version    integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rfqs_tenant_status
  ON rfq.procurement_rfqs (tenant_id, status);

-- ── tender module ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tender.procurement_tenders (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  tender_no        text        NOT NULL,
  title            text        NOT NULL,
  scope            text,
  eligibility      text,
  type             varchar(16) NOT NULL DEFAULT 'open',      -- open|limited|single_source|gem
  estimated_minor  bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  publish_date     date,
  bid_closing_date date        NOT NULL,
  opening_date     date,
  bids_received    integer     NOT NULL DEFAULT 0,
  status           varchar(16) NOT NULL DEFAULT 'draft',     -- draft|published|evaluation|awarded|cancelled
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, tender_no)
);

CREATE TABLE IF NOT EXISTS tender.procurement_tender_bids (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid        NOT NULL,
  tenant_id       uuid        NOT NULL,
  vendor_id       uuid        NOT NULL,
  vendor_name     text        NOT NULL DEFAULT '',
  bid_amount      bigint      NOT NULL DEFAULT 0,
  currency        char(3)     NOT NULL DEFAULT 'INR',
  technical_score integer,
  financial_score integer,
  status          varchar(16) NOT NULL DEFAULT 'submitted',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  version         integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tenders_tenant_status
  ON tender.procurement_tenders (tenant_id, status);
