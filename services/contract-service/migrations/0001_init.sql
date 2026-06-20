-- contract-service initial migration
-- Run bootstrap_contract.sql first (as civitas_admin), then this as contract_svc on civitas_contract.

CREATE SCHEMA IF NOT EXISTS contracts;
CREATE SCHEMA IF NOT EXISTS rate;

-- ── contracts module ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contracts.contract_contracts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  contract_no      text        NOT NULL,
  vendor_id        uuid        NOT NULL,
  po_ref           text,                   -- opaque "procurement_po:UUID"
  title            text        NOT NULL,
  value_minor      bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  start_date       date        NOT NULL,
  expiry           date        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'draft',  -- draft|active|expired|terminated
  sla_terms        jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, contract_no)
);

CREATE TABLE IF NOT EXISTS contracts.contract_milestones (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  title            text        NOT NULL,
  due_date         date        NOT NULL,
  amount_minor     bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  status           varchar(24) NOT NULL DEFAULT 'pending',  -- pending|achieved|overdue
  achieved_date    date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contracts.contract_amendments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  amendment_no     integer     NOT NULL DEFAULT 1,
  reason           text        NOT NULL,
  value_delta      bigint      NOT NULL DEFAULT 0,  -- paise change (may be negative)
  new_expiry       date,
  approved_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contracts_tenant
  ON contracts.contract_contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_expiry
  ON contracts.contract_contracts (expiry) WHERE status = 'active';

-- ── rate module ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate.contract_rate_contracts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  rc_no            text        NOT NULL,
  vendor_id        uuid        NOT NULL,
  title            text        NOT NULL,
  valid_from       date        NOT NULL,
  valid_until      date        NOT NULL,
  status           varchar(24) NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, rc_no)
);

CREATE TABLE IF NOT EXISTS rate.contract_rate_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rc_id            uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  item_code        text        NOT NULL,
  description      text        NOT NULL,
  unit             varchar(32) NOT NULL DEFAULT 'nos',
  unit_price_minor bigint      NOT NULL DEFAULT 0,
  currency         char(3)     NOT NULL DEFAULT 'INR',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_by       uuid        NOT NULL,
  version          integer     NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rate_items_code
  ON rate.contract_rate_items (rc_id, item_code);

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
